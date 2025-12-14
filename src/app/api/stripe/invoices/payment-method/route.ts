import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';

interface PaymentMethodResult {
  invoiceId: string;
  paymentMethodId: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PaymentMethodResult>>> {
  try {
    const body = await request.json();
    const { invoiceId, paymentMethodId, accountId } = body;

    if (!invoiceId || !paymentMethodId) {
      return NextResponse.json(
        { success: false, error: 'invoiceId and paymentMethodId are required' },
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

    if (invoice.status !== 'draft' && invoice.status !== 'open') {
      return NextResponse.json(
        { success: false, error: 'Can only change payment method on draft or open invoices' },
        { status: 400 }
      );
    }

    // Update the invoice with the new default payment method
    await stripe.invoices.update(invoiceId, {
      default_payment_method: paymentMethodId,
    });

    return NextResponse.json({
      success: true,
      data: { invoiceId, paymentMethodId },
    });
  } catch (error) {
    console.error('Error updating invoice payment method:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update payment method' },
      { status: 500 }
    );
  }
}
