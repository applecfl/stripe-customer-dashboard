import { NextRequest, NextResponse } from 'next/server';
import stripe from '@/lib/stripe';
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
    const { invoiceId, newAmount } = body;

    if (!invoiceId || !newAmount) {
      return NextResponse.json(
        { success: false, error: 'invoiceId and newAmount are required' },
        { status: 400 }
      );
    }

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
      // For draft invoices, use invoice items
      if (difference > 0) {
        // Add a new line item for the additional amount
        await stripe.invoiceItems.create({
          customer: invoice.customer as string,
          invoice: invoiceId,
          amount: difference,
          currency: invoice.currency,
          description: 'Amount adjustment',
        });
      } else {
        // Need to reduce the amount - create a negative line item
        await stripe.invoiceItems.create({
          customer: invoice.customer as string,
          invoice: invoiceId,
          amount: difference, // negative value
          currency: invoice.currency,
          description: 'Amount adjustment',
        });
      }
    } else if (invoice.status === 'open') {
      // For open invoices (including failed payments), handle differently
      if (difference > 0) {
        // Cannot increase amount on finalized invoice
        return NextResponse.json(
          { success: false, error: 'Cannot increase amount on a finalized invoice. You can only reduce it.' },
          { status: 400 }
        );
      } else {
        // Reduce amount using a credit note
        const creditAmount = Math.abs(difference);

        await stripe.creditNotes.create({
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
