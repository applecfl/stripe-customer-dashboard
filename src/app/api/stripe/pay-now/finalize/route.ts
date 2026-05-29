import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { distributePayment } from '@/lib/payNowCore';

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
    const reason = paymentIntent.metadata?.reason;

    // Distribute the (now succeeded, post-3DS) payment across the invoices.
    const { invoicesPaid, creditAdded } = await distributePayment({
      stripe,
      paymentIntent,
      customerId,
      invoiceUID,
      amount,
      reason,
      selectedInvoiceIds,
      applyToAll,
    });

    // Mark that this distribution happened after a 3DS step (parity with before).
    await stripe.paymentIntents.update(paymentIntent.id, {
      metadata: { ...paymentIntent.metadata, finalizedAfter3DS: 'true' },
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
