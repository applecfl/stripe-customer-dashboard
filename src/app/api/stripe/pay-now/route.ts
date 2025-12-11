import { NextRequest, NextResponse } from 'next/server';
import stripe from '@/lib/stripe';
import { ApiResponse } from '@/types';

interface PayNowResult {
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
): Promise<NextResponse<ApiResponse<PayNowResult>>> {
  try {
    const body = await request.json();
    const {
      customerId,
      paymentMethodId,
      amount,
      currency,
      reason,
      invoiceUID,
      selectedInvoiceIds,
      applyToAll,
      saveCard,
    } = body;

    if (!customerId || !paymentMethodId || !amount) {
      return NextResponse.json(
        { success: false, error: 'customerId, paymentMethodId, and amount are required' },
        { status: 400 }
      );
    }

    // If saveCard is true, attach the payment method to the customer first
    if (saveCard) {
      try {
        // Attach payment method to customer
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId,
        });
      } catch (attachError) {
        // Might already be attached, which is fine
        console.log('Payment method attachment:', attachError);
      }
    }

    // Create the payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: currency || 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      setup_future_usage: saveCard ? 'off_session' : undefined,
      metadata: {
        reason,
        InvoiceUID: invoiceUID,
        payNow: 'true',
        selectedInvoiceIds: selectedInvoiceIds ? selectedInvoiceIds.join(',') : '',
        cardSaved: saveCard ? 'true' : 'false',
      },
    });

    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json(
        { success: false, error: `Payment failed with status: ${paymentIntent.status}` },
        { status: 400 }
      );
    }

    // Now distribute the payment to invoices or add as credit
    let remainingAmount = amount;
    const invoicesPaid: PayNowResult['invoicesPaid'] = [];
    let creditAdded = 0;

    // Get open invoices to pay
    let invoicesToPay: typeof selectedInvoiceIds = [];

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

      // Sort draft invoices by finalize date ascending (closest/soonest first)
      // Prioritize metadata.scheduledFinalizeAt since that's where we store user's custom date
      filteredDraft.sort((a, b) => {
        const aDate = (a.metadata?.scheduledFinalizeAt ? parseInt(a.metadata.scheduledFinalizeAt, 10) : null) ||
          a.automatically_finalizes_at ||
          a.due_date || a.created;
        const bDate = (b.metadata?.scheduledFinalizeAt ? parseInt(b.metadata.scheduledFinalizeAt, 10) : null) ||
          b.automatically_finalizes_at ||
          b.due_date || b.created;
        return aDate - bDate; // Ascending - closest finalize date first
      });

      // Combine: failed first, then draft
      invoicesToPay = [...failedInvoices, ...filteredDraft].map(inv => inv.id);
    }

    // Apply payment to invoices
    for (const invoiceId of invoicesToPay) {
      if (remainingAmount <= 0) break;

      let invoice = await stripe.invoices.retrieve(invoiceId);

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
          // For draft invoices:
          // If fully paid -> delete the draft
          // If partially paid -> update the invoice line items to reduce the amount

          if (isFullyPaid) {
            // Fully paid - delete the draft invoice
            try {
              await stripe.invoices.del(invoiceId);
              console.log(`Deleted draft invoice ${invoiceId} - fully paid via PayNow`);
            } catch (deleteError) {
              console.log('Could not delete draft invoice:', invoiceId, deleteError);
              // If delete fails, just update metadata
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
            // Partial payment - reduce the draft invoice amount
            // We need to adjust line items to reduce the total
            const newAmount = invoiceAmount - amountToApply;

            // Get the invoice lines
            const lines = await stripe.invoices.listLineItems(invoiceId, { limit: 100 });

            if (lines.data.length > 0) {
              // Strategy: Update the first line item to reflect the new amount
              // Or add a discount line item for the payment received
              // Using invoice item approach - add a negative adjustment
              await stripe.invoiceItems.create({
                customer: customerId,
                invoice: invoiceId,
                amount: -amountToApply,
                currency: invoice.currency,
                description: `Payment received via PayNow (${paymentIntent.id})${reason ? ` - ${reason}` : ''}`,
              });
            }

            // Update metadata
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
          // For open invoices:
          // If fully paid, void the invoice first, then no credit note needed
          // If partially paid, create credit note to reduce amount_remaining

          if (isFullyPaid) {
            // Void the invoice - this marks it as voided and no longer collectable
            try {
              await stripe.invoices.voidInvoice(invoiceId);
              console.log(`Voided invoice ${invoiceId} - fully paid via PayNow`);
            } catch (voidError) {
              console.log('Could not void invoice:', invoiceId, voidError);
              // If void fails, fall back to credit note approach
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
            // Partial payment - use credit note to reduce amount_remaining
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

          // Update invoice metadata with payment history (if invoice still exists/accessible)
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
            // Invoice may have been voided, metadata update not critical
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

    // If there's remaining amount, add it as credit for future invoices
    if (remainingAmount > 0) {
      await stripe.customers.createBalanceTransaction(customerId, {
        amount: -remainingAmount,
        currency: currency || 'usd',
        description: `Credit from PayNow payment (${paymentIntent.id}). Reason: ${reason}. For InvoiceUID: ${invoiceUID}`,
        metadata: {
          paymentIntentId: paymentIntent.id,
          reason,
          InvoiceUID: invoiceUID,
          creditType: 'excess_payment',
        },
      });
      creditAdded = remainingAmount;
    }

    // Update the payment intent metadata with results
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: {
        ...paymentIntent.metadata,
        invoicesPaid: invoicesPaid.map(ip => ip.invoiceId).join(','),
        invoiceNumbersPaid: invoicesPaid.map(ip => ip.invoiceNumber || ip.invoiceId).join(','),
        totalAppliedToInvoices: (amount - remainingAmount).toString(),
        creditAdded: creditAdded.toString(),
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
    console.error('Error processing pay now:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to process payment' },
      { status: 500 }
    );
  }
}
