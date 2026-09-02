import { getDb } from './firestore';

// Firestore-backed payment links with a simple decrementing counter.
// Doc id = token signature (see getTokenSignature in auth.ts).
// NODE RUNTIME ONLY — firebase-admin cannot run on the Edge (middleware).
//
// Model: the link carries a fixed `amount` (from outstanding OR a custom value).
// On first view we initialise `remaining = amount`. Each successful payment
// decrements `remaining` by the amount paid. When `remaining` hits 0 the link is
// fully paid. We never recompute against live Stripe balances — the counter is the
// single source of truth for how much this link may still collect.

const COLLECTION = 'payment_links';

export type PaymentLinkStatus = 'pending' | 'paid';

export interface PaymentLinkRecord {
  status: PaymentLinkStatus;
  customerId: string;
  accountId: string;
  invoiceUID: string;
  amount: number;      // original amount the link was created for (cents)
  remaining: number;   // how much is still payable on this link (cents)
  createdAt: number;
  paidAt?: number;
  lastPaymentIntentId?: string;
  payments?: Array<{ paymentIntentId: string; amount: number; at: number }>;
  // Installment-plan bookkeeping. When a customer chooses a plan, the first payment is
  // charged via this link and the remaining N-1 are scheduled as future invoices. The
  // flag is the idempotency guard so retries/3DS re-entry never double-schedule.
  planChosen?: boolean;
  planCount?: number;
  planScheduled?: boolean;
  scheduledInvoiceIds?: string[];
}

/**
 * Read the current state of a payment link. Returns null if never seen.
 */
export async function getPaymentLink(sig: string): Promise<PaymentLinkRecord | null> {
  const snap = await getDb().collection(COLLECTION).doc(sig).get();
  return snap.exists ? (snap.data() as PaymentLinkRecord) : null;
}

/**
 * Get the link, creating it on first view with remaining = amount. Idempotent:
 * never lowers an existing remaining (only the very first init sets it).
 */
export async function getOrInitLink(
  sig: string,
  meta: { customerId: string; accountId: string; invoiceUID: string; amount: number }
): Promise<PaymentLinkRecord> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(sig);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return snap.data() as PaymentLinkRecord;
    const rec: PaymentLinkRecord = {
      status: 'pending',
      customerId: meta.customerId,
      accountId: meta.accountId,
      invoiceUID: meta.invoiceUID,
      amount: meta.amount,
      remaining: meta.amount,
      createdAt: Date.now(),
      payments: [],
    };
    tx.set(ref, rec);
    return rec;
  });
}

/**
 * Atomically reserve up to `want` cents against the link's remaining balance.
 * Returns the amount the caller MAY charge (min(want, remaining)) — call this
 * BEFORE creating the PaymentIntent. Returns 0 if nothing remains (already paid in
 * full) or the link is unknown.
 *
 * We don't pre-decrement here; commitPayment does the atomic decrement keyed to the
 * PaymentIntent after the charge succeeds. The double-charge guard is the Stripe
 * idempotency key (sig+pm+amount) set in the route.
 */
export async function getChargeableAmount(sig: string, want: number): Promise<number> {
  const rec = await getPaymentLink(sig);
  if (!rec) return 0;
  const remaining = rec.remaining ?? rec.amount;
  if (remaining <= 0) return 0;
  return Math.min(want, remaining);
}

/**
 * Apply a SUCCEEDED payment to the link: decrement remaining by `paid`, record the
 * PaymentIntent, and mark 'paid' when remaining reaches 0. Idempotent per
 * PaymentIntent — if this PI was already applied, it's a no-op (safe on retries).
 * Returns the new remaining.
 */
export async function commitPayment(
  sig: string,
  paymentIntentId: string,
  paid: number
): Promise<number> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(sig);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 0;
    const rec = snap.data() as PaymentLinkRecord;

    // Idempotency: if we've already recorded this PI, don't double-decrement.
    if (rec.payments?.some(p => p.paymentIntentId === paymentIntentId)) {
      return rec.remaining ?? 0;
    }

    const remaining = Math.max(0, (rec.remaining ?? rec.amount) - paid);
    const payments = [...(rec.payments ?? []), { paymentIntentId, amount: paid, at: Date.now() }];
    tx.set(
      ref,
      {
        remaining,
        payments,
        lastPaymentIntentId: paymentIntentId,
        ...(remaining <= 0 ? { status: 'paid' as PaymentLinkStatus, paidAt: Date.now() } : {}),
      },
      { merge: true }
    );
    return remaining;
  });
}

/**
 * Atomically claim the right to schedule this link's plan installments. Returns true to
 * exactly ONE caller (the first); subsequent callers get false so the future invoices are
 * never created twice (3DS re-entry, retries, double submit). Also marks the link as a plan
 * link and zeroes `remaining` (a plan is fulfilled by the first charge + scheduled invoices,
 * so the link can't be reused to over-collect).
 */
export async function claimPlanScheduling(sig: string, planCount: number): Promise<boolean> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(sig);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const rec = snap.data() as PaymentLinkRecord;
    if (rec.planScheduled) return false; // already scheduled by someone else
    tx.set(
      ref,
      {
        planChosen: true,
        planCount,
        planScheduled: true,
        status: 'paid' as PaymentLinkStatus,
        remaining: 0,
        paidAt: Date.now(),
      },
      { merge: true }
    );
    return true;
  });
}

/** Record the scheduled invoice ids after a successful createFutureInvoices call. */
export async function recordScheduledInvoices(sig: string, invoiceIds: string[]): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(sig).set({ scheduledInvoiceIds: invoiceIds }, { merge: true });
}

/** Undo a scheduling claim when the downstream createFutureInvoices call fails, so staff
 *  (or a retry) can try again rather than the plan being silently marked scheduled. */
export async function releasePlanScheduling(sig: string): Promise<void> {
  const db = getDb();
  await db.collection(COLLECTION).doc(sig).set({ planScheduled: false }, { merge: true });
}
