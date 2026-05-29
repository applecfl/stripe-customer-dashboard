import { getDb } from './firestore';

// Firestore-backed single-use enforcement + audit trail for payment links.
// Doc id = token signature (see getTokenSignature in auth.ts).
// NODE RUNTIME ONLY — firebase-admin cannot run on the Edge (middleware).

const COLLECTION = 'payment_links';

export type PaymentLinkStatus = 'pending' | 'paid';

export interface PaymentLinkRecord {
  status: PaymentLinkStatus;
  customerId: string;
  accountId: string;
  invoiceUID: string;
  amount: number;
  createdAt: number;
  paidAt?: number;
  paymentIntentId?: string;
}

/**
 * Read the current state of a payment link. Returns null if never seen.
 */
export async function getPaymentLink(sig: string): Promise<PaymentLinkRecord | null> {
  const snap = await getDb().collection(COLLECTION).doc(sig).get();
  return snap.exists ? (snap.data() as PaymentLinkRecord) : null;
}

/**
 * Atomically claim a payment link for charging. Returns true if THIS caller
 * won the claim (link was pending/unseen), false if it was already paid.
 * Run inside the charge flow BEFORE creating the PaymentIntent so two
 * simultaneous clicks can't both charge.
 */
export async function claimPaymentLink(
  sig: string,
  meta: { customerId: string; accountId: string; invoiceUID: string; amount: number; createdAt: number }
): Promise<boolean> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(sig);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && (snap.data() as PaymentLinkRecord).status === 'paid') {
      return false; // already consumed
    }
    tx.set(
      ref,
      { ...meta, status: 'pending' as PaymentLinkStatus },
      { merge: true }
    );
    return true;
  });
}

/**
 * Mark a claimed link as paid. Call after the PaymentIntent succeeds.
 * Once 'paid', the link can never be charged again (claimPaymentLink rejects it).
 * A failed charge leaves the doc 'pending', so the customer can simply retry.
 */
export async function markPaymentLinkPaid(
  sig: string,
  paymentIntentId: string
): Promise<void> {
  await getDb().collection(COLLECTION).doc(sig).set(
    {
      status: 'paid' as PaymentLinkStatus,
      paidAt: Date.now(),
      paymentIntentId,
    },
    { merge: true }
  );
}
