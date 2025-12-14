import { NextRequest, NextResponse } from 'next/server';
import stripe from '@/lib/stripe';
import { mapInvoice } from '@/lib/mappers';
import { InvoiceData, ApiResponse } from '@/types';

// Get single invoice
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
): Promise<NextResponse<ApiResponse<InvoiceData>>> {
  try {
    const { invoiceId } = await params;

    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['lines'],
    });

    return NextResponse.json({
      success: true,
      data: mapInvoice(invoice),
    });
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch invoice' },
      { status: 500 }
    );
  }
}

// Pay invoice (full or partial)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
): Promise<NextResponse<ApiResponse<InvoiceData>>> {
  try {
    const { invoiceId } = await params;
    const body = await request.json();
    const { amount, paymentMethodId, note } = body;

    const invoice = await stripe.invoices.retrieve(invoiceId);

    if (invoice.status !== 'open') {
      return NextResponse.json(
        { success: false, error: 'Invoice is not open' },
        { status: 400 }
      );
    }

    const amountRemaining = invoice.amount_remaining ?? 0;

    // If partial payment
    if (amount && amount < amountRemaining) {
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;

      // Create a payment intent for the partial amount
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: invoice.currency,
        customer: customerId,
        payment_method: paymentMethodId,
        confirm: true,
        metadata: {
          invoiceId: invoice.id,
          partialPayment: 'true',
          ...(note && { note }),
        },
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
      });

      if (paymentIntent.status === 'succeeded') {
        // Create a credit note to apply the payment to the invoice
        // This will reduce the invoice's amount_remaining
        await stripe.creditNotes.create({
          invoice: invoiceId,
          amount,
          reason: 'order_change',
          memo: `Partial payment received${note ? `: ${note}` : ''}`,
          metadata: {
            paymentIntentId: paymentIntent.id,
            partialPayment: 'true',
          },
        });

        // Update invoice metadata to track partial payments
        const previousPartialPayments = invoice.metadata?.totalPartialPayments
          ? parseInt(invoice.metadata.totalPartialPayments)
          : 0;

        await stripe.invoices.update(invoiceId, {
          metadata: {
            ...invoice.metadata,
            lastPartialPaymentAmount: amount.toString(),
            lastPartialPaymentDate: Date.now().toString(),
            lastPartialPaymentIntentId: paymentIntent.id,
            totalPartialPayments: (previousPartialPayments + amount).toString(),
            ...(note && { paymentNote: note }),
          },
        });
      }
    } else {
      // Full payment - pay the invoice directly
      await stripe.invoices.pay(invoiceId, {
        payment_method: paymentMethodId,
      });

      // Update invoice metadata with note if provided
      if (note) {
        await stripe.invoices.update(invoiceId, {
          metadata: {
            ...invoice.metadata,
            paymentNote: note,
            paymentDate: Date.now().toString(),
          },
        });
      }
    }

    // Fetch updated invoice
    const updatedInvoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['lines'],
    });

    return NextResponse.json({
      success: true,
      data: mapInvoice(updatedInvoice),
    });
  } catch (error) {
    console.error('Error paying invoice:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to pay invoice' },
      { status: 500 }
    );
  }
}

// Update invoice (pause, adjust amount, void, change payment method)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
): Promise<NextResponse<ApiResponse<InvoiceData>>> {
  try {
    const { invoiceId } = await params;
    const body = await request.json();
    const { action, pause, newAmount, reason, addCredit, paymentMethodId, newDueDate } = body;

    const invoice = await stripe.invoices.retrieve(invoiceId);

    switch (action) {
      case 'pause': {
        if (invoice.status === 'draft') {
          // For draft invoices, disable auto_advance and store original scheduled date
          if (pause) {
            // Get the original scheduled date from metadata or automatically_finalizes_at
            const originalScheduledDate = invoice.metadata?.scheduledFinalizeAt ||
              invoice.automatically_finalizes_at?.toString() || '';

            await stripe.invoices.update(invoiceId, {
              auto_advance: false, // Disable auto-finalization
              metadata: {
                ...invoice.metadata,
                isPaused: 'true',
                pausedAt: Date.now().toString(),
                originalScheduledDate,
                originalDueDate: invoice.due_date?.toString() || '',
              },
            });
          } else {
            // Resuming: restore auto_advance and original scheduled date
            const updateParams: Parameters<typeof stripe.invoices.update>[1] = {
              auto_advance: true,
              metadata: {
                ...invoice.metadata,
                isPaused: 'false',
                pausedAt: '',
                originalScheduledDate: '',
                originalDueDate: '',
              },
            };

            // Restore the original scheduled date if we have one
            const originalScheduledDate = invoice.metadata?.originalScheduledDate;
            if (originalScheduledDate) {
              updateParams.automatically_finalizes_at = parseInt(originalScheduledDate);
              // Also restore to our custom metadata field
              if (updateParams.metadata) {
                updateParams.metadata.scheduledFinalizeAt = originalScheduledDate;
              }
            }

            // Restore the original due date if we have one
            if (invoice.metadata?.originalDueDate) {
              updateParams.due_date = parseInt(invoice.metadata.originalDueDate);
            }

            await stripe.invoices.update(invoiceId, updateParams);
          }
        } else if (invoice.status === 'open') {
          // For open invoices, we can't change collection_method
          // Instead, we store the original payment method and remove it to prevent auto-charging
          // When unpausing, we restore the original payment method
          const currentPaymentMethod = invoice.default_payment_method;
          const originalPaymentMethod = invoice.metadata?.originalPaymentMethod ||
            (typeof currentPaymentMethod === 'string' ? currentPaymentMethod : currentPaymentMethod?.id);

          if (pause) {
            // Pausing: save original payment method and remove it
            await stripe.invoices.update(invoiceId, {
              metadata: {
                ...invoice.metadata,
                isPaused: 'true',
                originalDueDate: invoice.due_date?.toString() || '',
                originalPaymentMethod: originalPaymentMethod || '',
              },
              // Remove default payment method to prevent auto-charging
              default_payment_method: '',
            });
          } else {
            // Unpausing: restore original payment method if it exists
            const updateParams: Parameters<typeof stripe.invoices.update>[1] = {
              metadata: {
                ...invoice.metadata,
                isPaused: 'false',
                originalDueDate: '',
                originalPaymentMethod: '',
              },
            };

            // Restore the original payment method if we have one
            if (invoice.metadata?.originalPaymentMethod) {
              updateParams.default_payment_method = invoice.metadata.originalPaymentMethod;
            }

            await stripe.invoices.update(invoiceId, updateParams);
          }
        } else {
          return NextResponse.json(
            { success: false, error: 'Can only pause draft or open invoices' },
            { status: 400 }
          );
        }
        break;
      }

      case 'adjust': {
        if (!newAmount || !reason) {
          return NextResponse.json(
            { success: false, error: 'newAmount and reason are required for adjustment' },
            { status: 400 }
          );
        }

        // Can only adjust draft invoices
        if (invoice.status !== 'draft') {
          return NextResponse.json(
            { success: false, error: 'Can only adjust draft invoices' },
            { status: 400 }
          );
        }

        // Get existing lines to calculate adjustment
        const currentTotal = invoice.amount_due ?? 0;
        const difference = currentTotal - newAmount;

        if (difference !== 0) {
          // Add a line item to adjust the total
          await stripe.invoiceItems.create({
            customer: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '',
            invoice: invoiceId,
            amount: -difference, // Negative to reduce the total
            currency: invoice.currency,
            description: `Adjustment: ${reason}`,
          });
        }

        // Update metadata with adjustment note
        await stripe.invoices.update(invoiceId, {
          metadata: {
            ...invoice.metadata,
            adjustmentNote: reason,
            originalAmount: currentTotal.toString(),
            adjustedAt: Date.now().toString(),
          },
        });
        break;
      }

      case 'finalize': {
        // Finalize a draft invoice (makes it open and ready for payment)
        if (invoice.status !== 'draft') {
          return NextResponse.json(
            { success: false, error: 'Can only finalize draft invoices' },
            { status: 400 }
          );
        }

        await stripe.invoices.finalizeInvoice(invoiceId);
        break;
      }

      case 'retry': {
        // Retry payment on a failed invoice
        if (invoice.status !== 'open') {
          return NextResponse.json(
            { success: false, error: 'Can only retry open invoices' },
            { status: 400 }
          );
        }

        // Attempt to pay the invoice again
        await stripe.invoices.pay(invoiceId);
        break;
      }

      case 'void': {
        if (invoice.status !== 'open') {
          return NextResponse.json(
            { success: false, error: 'Can only void open invoices' },
            { status: 400 }
          );
        }

        // Add credit to customer balance if requested
        if (addCredit) {
          const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
          if (customerId) {
            await stripe.customers.createBalanceTransaction(customerId, {
              amount: -(invoice.amount_remaining ?? 0),
              currency: invoice.currency,
              description: `Credit from voided invoice ${invoice.number || invoice.id}${reason ? `: ${reason}` : ''}`,
            });
          }
        }

        // Void the invoice
        await stripe.invoices.voidInvoice(invoiceId);
        break;
      }

      case 'change-payment-method': {
        // paymentMethodId can be empty string to remove payment method
        if (paymentMethodId === undefined || paymentMethodId === null) {
          return NextResponse.json(
            { success: false, error: 'paymentMethodId is required (use empty string to remove)' },
            { status: 400 }
          );
        }

        // Can only change payment method on draft or open invoices
        if (invoice.status !== 'draft' && invoice.status !== 'open') {
          return NextResponse.json(
            { success: false, error: 'Can only change payment method on draft or open invoices' },
            { status: 400 }
          );
        }

        // Update the invoice's default payment method (empty string removes it)
        await stripe.invoices.update(invoiceId, {
          default_payment_method: paymentMethodId || '',
        });
        break;
      }

      case 'change-due-date': {
        if (!newDueDate) {
          return NextResponse.json(
            { success: false, error: 'Finalization date is required' },
            { status: 400 }
          );
        }

        // Can only change finalization date on draft invoices
        if (invoice.status !== 'draft') {
          return NextResponse.json(
            { success: false, error: 'Can only change finalization date on draft invoices' },
            { status: 400 }
          );
        }

        // Update the invoice's auto-finalization date
        // This schedules when the invoice will be automatically finalized
        await stripe.invoices.update(invoiceId, {
          auto_advance: true,
          automatically_finalizes_at: newDueDate,
        });
        break;
      }

      case 'send-reminder': {
        // Can only send reminders for open invoices with remaining balance
        if (invoice.status !== 'open') {
          return NextResponse.json(
            { success: false, error: 'Can only send reminders for open invoices' },
            { status: 400 }
          );
        }

        // Send the invoice reminder using Stripe's built-in email
        await stripe.invoices.sendInvoice(invoiceId);
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }

    // Fetch updated invoice
    const updatedInvoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['lines'],
    });

    return NextResponse.json({
      success: true,
      data: mapInvoice(updatedInvoice),
    });
  } catch (error) {
    console.error('Error updating invoice:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update invoice' },
      { status: 500 }
    );
  }
}

// Delete draft invoice
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
): Promise<NextResponse<ApiResponse<{ deleted: boolean }>>> {
  try {
    const { invoiceId } = await params;

    const invoice = await stripe.invoices.retrieve(invoiceId);

    // Can only delete draft invoices
    if (invoice.status !== 'draft') {
      return NextResponse.json(
        { success: false, error: 'Can only delete draft invoices' },
        { status: 400 }
      );
    }

    // Delete the invoice
    await stripe.invoices.del(invoiceId);

    return NextResponse.json({
      success: true,
      data: { deleted: true },
    });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to delete invoice' },
      { status: 500 }
    );
  }
}
