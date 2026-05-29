import Stripe from 'stripe';

// Server-side live outstanding balance for a given InvoiceUID, mirroring the
// dashboard's "failed payments" sum: open invoices that have failed at least one
// charge attempt, scoped to this InvoiceUID. This is the authoritative amount a
// dynamic payment link may collect — recomputed on every visit so the page and the
// email button always reflect what's truly still owed.

/**
 * Sum of amount_remaining across OPEN invoices for this customer+InvoiceUID that
 * have failed a payment attempt (attempt_count > 0). Returns cents.
 */
export async function getOutstandingForUID(
  stripe: Stripe,
  customerId: string,
  invoiceUID: string
): Promise<number> {
  const open = await stripe.invoices.list({
    customer: customerId,
    status: 'open',
    limit: 100,
  });

  return open.data
    .filter(
      inv =>
        (inv.metadata?.InvoiceUID === invoiceUID || inv.metadata?.invoiceUID === invoiceUID) &&
        (inv.attempt_count || 0) > 0
    )
    .reduce((sum, inv) => sum + (inv.amount_remaining || 0), 0);
}
