import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';

interface AdjustResult {
  invoiceId: string;
  newAmount: number;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<AdjustResult>>> {
  try {
    const body = await request.json();
    const { invoiceId, newAmount, accountId } = body;

    if (!invoiceId || !newAmount) {
      return NextResponse.json(
        { success: false, error: 'invoiceId and newAmount are required' },
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

    // Get the current invoice
    const invoice = await stripe.invoices.retrieve(invoiceId);

    // Calculate the difference
    const currentAmount = invoice.amount_due;
    const difference = newAmount - currentAmount;

    if (difference === 0) {
      return NextResponse.json({
        success: true,
        data: { invoiceId, newAmount },
      });
    }

    if (invoice.status === 'draft') {
      // For draft invoices, we need to update the amount by modifying the invoice items
      // Get line items from the invoice for the description
      const lineItems = await stripe.invoices.listLineItems(invoiceId);
      const originalDescription = lineItems.data[0]?.description || 'Payment';

      // List all invoice items for this customer and find ones attached to this invoice
      const allInvoiceItems = await stripe.invoiceItems.list({
        customer: invoice.customer as string,
        limit: 100,
      });

      // Delete invoice items that belong to this invoice
      for (const item of allInvoiceItems.data) {
        if (item.invoice === invoiceId) {
          try {
            await stripe.invoiceItems.del(item.id);
            console.log('Deleted invoice item:', item.id);
          } catch (deleteError) {
            console.error('Error deleting invoice item:', item.id, deleteError);
          }
        }
      }

      // Create a single new line item with the new total amount
      await stripe.invoiceItems.create({
        customer: invoice.customer as string,
        invoice: invoiceId,
        amount: newAmount,
        currency: invoice.currency,
        description: originalDescription,
      });
      console.log('Created new invoice item with amount:', newAmount);
    } else if (invoice.status === 'open') {
      // For open invoices (including failed payments), handle differently
      console.log('Processing open invoice adjustment:', { invoiceId, currentAmount, newAmount, difference });

      if (difference > 0) {
        // Cannot increase amount on finalized invoice
        return NextResponse.json(
          { success: false, error: 'Cannot increase amount on a finalized invoice. You can only reduce it.' },
          { status: 400 }
        );
      } else {
        // Check if there's a pending payment intent that needs to be canceled first
        const invoiceData = invoice as unknown as { payment_intent?: string | { id: string } };
        const paymentIntentId = typeof invoiceData.payment_intent === 'string'
          ? invoiceData.payment_intent
          : invoiceData.payment_intent?.id;
        if (paymentIntentId && typeof paymentIntentId === 'string') {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            console.log('Payment intent status:', paymentIntent.status);

            // Cancel the payment intent if it's in a cancellable state
            if (['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing'].includes(paymentIntent.status)) {
              await stripe.paymentIntents.cancel(paymentIntentId);
              console.log('Canceled payment intent:', paymentIntentId);
            }
          } catch (piError) {
            console.error('Error handling payment intent:', piError);
            // Continue - the payment intent might already be in a final state
          }
        }

        // Reduce amount using a credit note
        const creditAmount = Math.abs(difference);
        console.log('Creating credit note with amount:', creditAmount);

        try {
          const creditNote = await stripe.creditNotes.create({
            invoice: invoiceId,
            lines: [
              {
                type: 'custom_line_item',
                description: 'Amount adjustment',
                quantity: 1,
                unit_amount: creditAmount,
              },
            ],
          });
          console.log('Credit note created:', creditNote.id);
        } catch (creditError) {
          // If credit note fails due to pending payment, we can't adjust this invoice directly
          // Return error to let user know they need to use a different approach
          console.error('Credit note failed:', creditError);

          const errorMessage = creditError instanceof Error ? creditError.message : 'Unknown error';

          // If the error is about pending payment, suggest voiding and recreating
          if (errorMessage.includes('payment pending')) {
            return NextResponse.json(
              {
                success: false,
                error: 'Cannot adjust amount while payment is pending. Please void this invoice and create a new one with the correct amount.',
              },
              { status: 400 }
            );
          }

          // For other errors, try customer balance as fallback
          try {
            await stripe.customers.createBalanceTransaction(invoice.customer as string, {
              amount: -creditAmount, // Negative amount = credit
              currency: invoice.currency,
              description: `Credit for invoice ${invoiceId} adjustment`,
            });
            console.log('Added customer balance credit:', creditAmount);
          } catch (balanceError) {
            console.error('Customer balance credit also failed:', balanceError);
            return NextResponse.json(
              { success: false, error: 'Failed to adjust invoice amount. Please try voiding and recreating the invoice.' },
              { status: 500 }
            );
          }
        }
      }
    } else {
      return NextResponse.json(
        { success: false, error: `Cannot adjust invoice with status: ${invoice.status}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { invoiceId, newAmount },
    });
  } catch (error) {
    console.error('Error adjusting invoice:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to adjust invoice' },
      { status: 500 }
    );
  }
}
