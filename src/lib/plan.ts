import Stripe from 'stripe';
import { TokenPayload } from './auth';
import { buildPlan } from './installments';
import { claimPlanScheduling, recordScheduledInvoices, releasePlanScheduling } from './paymentLinks';

// Shared logic for scheduling the remaining installments of a payment plan AFTER the first
// installment has been charged (via the pay-link flow). Called by both the pay-link POST
// route (no-3DS path) and the finalize route (3DS path), so it must be idempotent.
//
// We DO NOT build our own scheduler: the remaining monthly invoices are handed to the
// existing engine at ${EXTERNAL_API_URL}/stripe/createFutureInvoices (lecapp-webhooks →
// createInvoiceWithItems), which finalizes & charges each one automatically on its date.

const EXTERNAL_API_URL = process.env.EXTERNAL_API_URL || 'https://webhook.lec.li';

export interface SchedulePlanResult {
  scheduled: boolean;   // did we (this call) schedule the remainder?
  count: number;        // number of future invoices requested
  error?: string;
}

/**
 * After the first installment is paid, schedule installments #2..N as future invoices.
 *
 * @param sig            the payment-link signature (Firestore doc id + idempotency key)
 * @param payload        the verified token payload (carries plan + customer/account/invoiceUID)
 * @param paymentIntent  the succeeded first-installment PaymentIntent (card + now-anchor)
 * @param planCount      how many installments the customer chose (>= 2)
 * @param nowSec         the instant the plan is anchored to (charge time)
 */
export async function schedulePlanRemainder(
  sig: string,
  payload: TokenPayload,
  paymentIntent: Stripe.PaymentIntent,
  planCount: number,
  nowSec: number
): Promise<SchedulePlanResult> {
  if (!payload.plan) return { scheduled: false, count: 0, error: 'no plan on token' };
  if (!payload.amount || payload.amount <= 0) return { scheduled: false, count: 0, error: 'no amount' };

  // Recompute the split server-side from the SIGNED plan — never trust client amounts.
  const installments = buildPlan(payload.amount, planCount, nowSec, payload.plan.endDate);
  const future = installments.slice(1); // #0 was just charged via the pay-link
  if (future.length === 0) return { scheduled: false, count: 0 };

  // The card to charge future invoices to — the PM used for the first installment.
  const paymentMethodId =
    typeof paymentIntent.payment_method === 'string'
      ? paymentIntent.payment_method
      : paymentIntent.payment_method?.id;
  if (!paymentMethodId) return { scheduled: false, count: future.length, error: 'no payment method on PI' };

  // Idempotency: only ONE caller proceeds. 3DS re-entry / retries get scheduled:false here.
  const claimed = await claimPlanScheduling(sig, planCount);
  if (!claimed) return { scheduled: false, count: future.length };

  try {
    // Build the exact dates + per-date amounts and hand them to the engine in customDates
    // ("Dates") mode. Dates as ISO (YYYY-MM-DD) in NY; the engine finalizes at that date.
    const dates = future.map((f) =>
      new Date(f.date * 1000).toISOString().slice(0, 10)
    );
    const amounts = future.map((f) => f.amount);

    const requestBody = {
      AccountID: payload.accountId,
      Invoices: [
        {
          CustomerID: payload.customerId,
          Amount: amounts, // per-date amounts (engine supports an array in customDates mode)
          Description: payload.extendedInfo?.paymentName || 'Payment plan installment',
          Currency: 'usd',
          Frequency: 'Dates',
          Dates: dates,
          FirstPaymentNumber: 2, // #1 was the immediate pay-link charge
          PaymentMethodId: paymentMethodId,
          Metadata: {
            InvoiceUID: payload.invoiceUID,
            planGroup: sig,
            paidViaPayLinkPlan: 'true',
          },
        },
      ],
    };

    const res = await fetch(`${EXTERNAL_API_URL}/stripe/createFutureInvoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const result = await res.json().catch(() => ({}));

    if (!res.ok || result?.Success === 0) {
      const msg = result?.Message || result?.error || `HTTP ${res.status}`;
      // Release the claim so a retry (or staff) can schedule the remainder later. The first
      // installment already succeeded — we must NOT fail the customer's payment over this.
      await releasePlanScheduling(sig);
      console.error('[plan] createFutureInvoices failed:', msg);
      return { scheduled: false, count: future.length, error: String(msg) };
    }

    // Best-effort: record any returned invoice ids for later reconciliation.
    const ids: string[] = Array.isArray(result?.AllInvoicesResults)
      ? result.AllInvoicesResults.flatMap((r: { invoices?: Array<{ id?: string }> }) =>
          (r.invoices || []).map((i) => i.id).filter(Boolean) as string[]
        )
      : [];
    if (ids.length) await recordScheduledInvoices(sig, ids);

    return { scheduled: true, count: future.length };
  } catch (e) {
    await releasePlanScheduling(sig);
    console.error('[plan] scheduling error:', e);
    return { scheduled: false, count: future.length, error: e instanceof Error ? e.message : 'scheduling failed' };
  }
}
