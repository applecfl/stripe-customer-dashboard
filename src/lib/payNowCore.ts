import Stripe from 'stripe';

// Shared "apply a succeeded payment to a customer's invoices" logic, extracted
// verbatim from the original pay-now route so both the admin pay-now flow and the
// customer-facing pay-link flow distribute payments identically.

export interface InvoicePaid {
  invoiceId: string;
  invoiceNumber: string | null;
  amountApplied: number;
}

export interface DistributeResult {
  invoicesPaid: InvoicePaid[];
  creditAdded: number;
  remainingAmount: number;
}

interface DistributeArgs {
  stripe: Stripe;
  paymentIntent: Stripe.PaymentIntent;
  customerId: string;
  invoiceUID: string;
  amount: number;
  reason?: string;
  selectedInvoiceIds?: string[] | null;
  applyToAll?: boolean;
}

/**
 * Resolve the ordered list of invoice ids a payment should be applied to:
 * explicit selection, else (applyToAll) failed-open-invoices first then drafts.
 */
async function resolveInvoicesToPay(
  stripe: Stripe,
  customerId: string,
  invoiceUID: string,
  selectedInvoiceIds?: string[] | null,
  applyToAll?: boolean
): Promise<string[]> {
  if (selectedInvoiceIds && selectedInvoiceIds.length > 0) {
    return selectedInvoiceIds;
  }
  if (!applyToAll) return [];

  const [openInvoices, draftInvoices] = await Promise.all([
    stripe.invoices.list({ customer: customerId, status: 'open', limit: 100 }),
    stripe.invoices.list({ customer: customerId, status: 'draft', limit: 100 }),
  ]);

  const filteredOpen = openInvoices.data.filter(
    inv => inv.metadata?.InvoiceUID === invoiceUID || inv.metadata?.invoiceUID === invoiceUID
  );
  const filteredDraft = draftInvoices.data.filter(
    inv => inv.metadata?.InvoiceUID === invoiceUID || inv.metadata?.invoiceUID === invoiceUID
  );

  // Failed invoices (open with attempt_count > 0), oldest due first
  const failedInvoices = filteredOpen.filter(inv => (inv.attempt_count || 0) > 0);
  failedInvoices.sort((a, b) => (a.due_date || a.created) - (b.due_date || b.created));

  // Drafts by soonest scheduled/finalize/due date first
  const draftSortDate = (inv: Stripe.Invoice): number =>
    (inv.metadata?.scheduledFinalizeAt ? parseInt(inv.metadata.scheduledFinalizeAt, 10) : 0) ||
    inv.automatically_finalizes_at || inv.due_date || inv.created;
  filteredDraft.sort((a, b) => draftSortDate(a) - draftSortDate(b));

  return [...failedInvoices, ...filteredDraft].map(inv => inv.id);
}

/**
 * Apply an already-succeeded PaymentIntent's amount across the customer's
 * invoices (drafts: delete/reduce; open: void/credit-note), recording payment
 * history in invoice metadata, then stamp the PaymentIntent with a summary.
 */
export async function distributePayment(args: DistributeArgs): Promise<DistributeResult> {
  const { stripe, paymentIntent, customerId, invoiceUID, amount } = args;
  // Stripe metadata values must be string|number|null (not undefined).
  const reason = args.reason ?? '';

  let remainingAmount = amount;
  const invoicesPaid: InvoicePaid[] = [];
  const creditAdded = 0;

  const invoicesToPay = await resolveInvoicesToPay(
    stripe, customerId, invoiceUID, args.selectedInvoiceIds, args.applyToAll
  );

  for (const invoiceId of invoicesToPay) {
    if (remainingAmount <= 0) break;

    const invoice = await stripe.invoices.retrieve(invoiceId);

    let invoiceAmount = 0;
    if (invoice.status === 'draft') {
      invoiceAmount = invoice.amount_due || 0;
    } else if (invoice.status === 'open') {
      invoiceAmount = invoice.amount_remaining || 0;
    } else {
      continue; // skip paid/void
    }
    if (invoiceAmount <= 0) continue;

    const amountToApply = Math.min(remainingAmount, invoiceAmount);

    const existingPayments = invoice.metadata?.paymentHistory
      ? JSON.parse(invoice.metadata.paymentHistory)
      : [];
    existingPayments.push({
      paymentIntentId: paymentIntent.id,
      amount: amountToApply,
      reason,
      date: Date.now(),
      type: 'payNow',
    });
    const totalPaid = existingPayments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);

    try {
      const isFullyPaid = amountToApply >= invoiceAmount;

      if (invoice.status === 'draft') {
        if (isFullyPaid) {
          try {
            await stripe.invoices.del(invoiceId);
          } catch (deleteError) {
            console.log('Could not delete draft invoice:', invoiceId, deleteError);
            await stripe.invoices.update(invoiceId, {
              metadata: {
                ...invoice.metadata,
                paymentHistory: JSON.stringify(existingPayments),
                totalPaid: totalPaid.toString(),
                lastPaymentIntentId: paymentIntent.id,
                lastPaymentReason: reason,
                lastPaymentAmount: amountToApply.toString(),
                lastPaymentDate: Date.now().toString(),
                paidViaPayNow: 'true',
              },
            });
          }
        } else {
          await stripe.invoiceItems.create({
            customer: customerId,
            invoice: invoiceId,
            amount: -amountToApply,
            currency: invoice.currency,
            description: `Payment received via PayNow (${paymentIntent.id})${reason ? ` - ${reason}` : ''}`,
          });
          await stripe.invoices.update(invoiceId, {
            metadata: {
              ...invoice.metadata,
              paymentHistory: JSON.stringify(existingPayments),
              totalPaid: totalPaid.toString(),
              lastPaymentIntentId: paymentIntent.id,
              lastPaymentReason: reason,
              lastPaymentAmount: amountToApply.toString(),
              lastPaymentDate: Date.now().toString(),
              paidViaPayNow: 'false',
              originalAmount: invoice.metadata?.originalAmount || invoiceAmount.toString(),
            },
          });
        }
      } else {
        // open invoice
        if (isFullyPaid) {
          try {
            await stripe.invoices.voidInvoice(invoiceId);
          } catch (voidError) {
            console.log('Could not void invoice:', invoiceId, voidError);
            await stripe.creditNotes.create({
              invoice: invoiceId,
              amount: amountToApply,
              reason: 'order_change',
              memo: `Payment received via PayNow (${paymentIntent.id})${reason ? `. Note: ${reason}` : ''}`,
              metadata: { paymentIntentId: paymentIntent.id, partialPayment: 'false', InvoiceUID: invoiceUID },
            });
          }
        } else {
          await stripe.creditNotes.create({
            invoice: invoiceId,
            amount: amountToApply,
            reason: 'order_change',
            memo: `Partial payment received via PayNow (${paymentIntent.id})${reason ? `. Note: ${reason}` : ''}`,
            metadata: { paymentIntentId: paymentIntent.id, partialPayment: 'true', InvoiceUID: invoiceUID },
          });
        }
        try {
          await stripe.invoices.update(invoiceId, {
            metadata: {
              ...invoice.metadata,
              paymentHistory: JSON.stringify(existingPayments),
              totalPaid: totalPaid.toString(),
              lastPaymentIntentId: paymentIntent.id,
              lastPaymentReason: reason || '',
              lastPaymentAmount: amountToApply.toString(),
              lastPaymentDate: Date.now().toString(),
              paidViaPayNow: isFullyPaid ? 'true' : 'false',
            },
          });
        } catch {
          console.log('Could not update invoice metadata:', invoiceId);
        }
      }

      invoicesPaid.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amountApplied: amountToApply,
      });
      remainingAmount -= amountToApply;
    } catch (payError) {
      console.error('Failed to process payment for invoice:', invoiceId, payError);
    }
  }

  // Stamp the PaymentIntent with a summary for later display.
  await stripe.paymentIntents.update(paymentIntent.id, {
    metadata: {
      ...paymentIntent.metadata,
      invoicesPaid: invoicesPaid.map(ip => ip.invoiceId).join(','),
      invoiceNumbersPaid: invoicesPaid.map(ip => ip.invoiceNumber || ip.invoiceId).join(','),
      invoiceAmounts: invoicesPaid.map(ip => ip.amountApplied.toString()).join(','),
      totalAppliedToInvoices: (amount - remainingAmount).toString(),
      creditAdded: creditAdded.toString(),
    },
  });

  return { invoicesPaid, creditAdded, remainingAmount };
}
