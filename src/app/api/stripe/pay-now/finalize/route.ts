import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';

interface FinalizeResult {
  paymentIntentId: string;
  amountPaid: number;
  invoicesPaid: Array<{
    invoiceId: string;
    invoiceNumber: string | null;
    amountApplied: number;
  }>;
  creditAdded: number;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<FinalizeResult>>> {
  try {
    const body = await request.json();
    const {
      paymentIntentId,
      customerId,
      invoiceUID,
      selectedInvoiceIds,
      applyToAll,
      accountId,
    } = body;

    if (!paymentIntentId || !customerId) {
      return NextResponse.json(
        { success: false, error: 'paymentIntentId and customerId are required' },
        { status: 400 }
      );
    }

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: 'accountId is required' },
        { status: 400 }
      );
    }

    const stripe = getStripeForAccount(accountId);

    // Retrieve the payment intent to verify it succeeded
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json(
        { success: false, error: `Payment not completed. Status: ${paymentIntent.status}` },
        { status: 400 }
      );
    }

    const amount = paymentIntent.amount;
    const currency = paymentIntent.currency;
    const reason = paymentIntent.metadata?.reason;

    // Now distribute the payment to invoices or add as credit
    let remainingAmount = amount;
    const invoicesPaid: FinalizeResult['invoicesPaid'] = [];
    let creditAdded = 0;

    // Get open invoices to pay
    let invoicesToPay: string[] = [];

    if (selectedInvoiceIds && selectedInvoiceIds.length > 0) {
      // Pay specific invoices in order
      invoicesToPay = selectedInvoiceIds;
    } else if (applyToAll) {
      // Get all open and draft invoices with the same InvoiceUID
      const [openInvoices, draftInvoices] = await Promise.all([
        stripe.invoices.list({
          customer: customerId,
          status: 'open',
          limit: 100,
        }),
        stripe.invoices.list({
          customer: customerId,
          status: 'draft',
          limit: 100,
        }),
      ]);

      // Filter by InvoiceUID
      const filteredOpen = openInvoices.data.filter(
        inv => inv.metadata?.InvoiceUID === invoiceUID || inv.metadata?.invoiceUID === invoiceUID
      );
      const filteredDraft = draftInvoices.data.filter(
        inv => inv.metadata?.InvoiceUID === invoiceUID || inv.metadata?.invoiceUID === invoiceUID
      );

      // Separate failed invoices (open with attempt_count > 0) from other open invoices
      const failedInvoices = filteredOpen.filter(inv => (inv.attempt_count || 0) > 0);

      // Sort failed invoices: oldest to newest (by due_date ascending)
      failedInvoices.sort((a, b) => (a.due_date || a.created) - (b.due_date || b.created));

      // Sort draft invoices by Payment date ascending (closest/soonest first)
      filteredDraft.sort((a, b) => {
        const aDate = (a.metadata?.scheduledFinalizeAt ? parseInt(a.metadata.scheduledFinalizeAt, 10) : null) ||
          a.automatically_finalizes_at ||
          a.due_date || a.created;
        const bDate = (b.metadata?.scheduledFinalizeAt ? parseInt(b.metadata.scheduledFinalizeAt, 10) : null) ||
          b.automatically_finalizes_at ||
          b.due_date || b.created;
        return aDate - bDate;
      });

      // Combine: failed first, then draft
      invoicesToPay = [...failedInvoices, ...filteredDraft].map(inv => inv.id);
    }

    // Apply payment to invoices
    for (const invoiceId of invoicesToPay) {
      if (remainingAmount <= 0) break;

      const invoice = await stripe.invoices.retrieve(invoiceId);

      // Get the amount to work with based on invoice status
      let invoiceAmount = 0;
      if (invoice.status === 'draft') {
        invoiceAmount = invoice.amount_due || 0;
      } else if (invoice.status === 'open') {
        invoiceAmount = invoice.amount_remaining || 0;
      } else {
        continue; // Skip paid/void invoices
      }

      if (invoiceAmount <= 0) continue;

      const amountToApply = Math.min(remainingAmount, invoiceAmount);

      // Build payment history from existing metadata
      const existingPayments = invoice.metadata?.paymentHistory
        ? JSON.parse(invoice.metadata.paymentHistory)
        : [];

      // Add new payment to history
      const newPayment = {
        paymentIntentId: paymentIntent.id,
        amount: amountToApply,
        reason,
        date: Date.now(),
        type: 'payNow',
      };
      existingPayments.push(newPayment);

      // Calculate total paid from history
      const totalPaid = existingPayments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);

      try {
        const isFullyPaid = amountToApply >= invoiceAmount;

        if (invoice.status === 'draft') {
          if (isFullyPaid) {
            // Fully paid - delete the draft invoice
            try {
              await stripe.invoices.del(invoiceId);
              console.log(`Deleted draft invoice ${invoiceId} - fully paid via PayNow (3DS)`);
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
            // Partial payment - add negative adjustment
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

          invoicesPaid.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            amountApplied: amountToApply,
          });

          remainingAmount -= amountToApply;
        } else {
          // For open invoices
          if (isFullyPaid) {
            try {
              await stripe.invoices.voidInvoice(invoiceId);
              console.log(`Voided invoice ${invoiceId} - fully paid via PayNow (3DS)`);
            } catch (voidError) {
              console.log('Could not void invoice:', invoiceId, voidError);
              await stripe.creditNotes.create({
                invoice: invoiceId,
                amount: amountToApply,
                reason: 'order_change',
                memo: `Payment received via PayNow (${paymentIntent.id})${reason ? `. Note: ${reason}` : ''}`,
                metadata: {
                  paymentIntentId: paymentIntent.id,
                  partialPayment: 'false',
                  InvoiceUID: invoiceUID,
                },
              });
            }
          } else {
            await stripe.creditNotes.create({
              invoice: invoiceId,
              amount: amountToApply,
              reason: 'order_change',
              memo: `Partial payment received via PayNow (${paymentIntent.id})${reason ? `. Note: ${reason}` : ''}`,
              metadata: {
                paymentIntentId: paymentIntent.id,
                partialPayment: 'true',
                InvoiceUID: invoiceUID,
              },
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
          } catch (updateError) {
            console.log('Could not update invoice metadata:', invoiceId);
          }

          invoicesPaid.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            amountApplied: amountToApply,
          });

          remainingAmount -= amountToApply;
        }
      } catch (payError) {
        console.error('Failed to process payment for invoice:', invoiceId, payError);
      }
    }

    // Note: Remaining amount stays as payment only - no automatic credit addition
    // Credit is only added via credit notes when partially paying specific invoices

    // Update the payment intent metadata with results
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: {
        ...paymentIntent.metadata,
        invoicesPaid: invoicesPaid.map(ip => ip.invoiceId).join(','),
        invoiceNumbersPaid: invoicesPaid.map(ip => ip.invoiceNumber || ip.invoiceId).join(','),
        invoiceAmounts: invoicesPaid.map(ip => ip.amountApplied.toString()).join(','),
        totalAppliedToInvoices: (amount - remainingAmount).toString(),
        creditAdded: creditAdded.toString(),
        finalizedAfter3DS: 'true',
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        paymentIntentId: paymentIntent.id,
        amountPaid: amount,
        invoicesPaid,
        creditAdded,
      },
    });
  } catch (error) {
    console.error('Error finalizing pay now:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to finalize payment' },
      { status: 500 }
    );
  }
}
