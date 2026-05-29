import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { verifyToken, getTokenSignature } from '@/lib/auth';
import { distributePayment } from '@/lib/payNowCore';
import { markPaymentLinkPaid, getPaymentLink } from '@/lib/paymentLinks';

interface FinalizeResult {
  paymentIntentId: string;
  amountPaid: number;
  invoicesPaid: Array<{ invoiceId: string; invoiceNumber: string | null; amountApplied: number }>;
}

// Completes a payment-link charge after client-side 3DS. Verifies the PaymentIntent
// actually belongs to this token's customer and succeeded before distributing.
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<FinalizeResult>>> {
  try {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 401 });
    }
    const payload = verifyToken(token);
    if (!payload || payload.kind !== 'payment_link') {
      return NextResponse.json({ success: false, error: 'Invalid payment link' }, { status: 401 });
    }

    const { customerId, invoiceUID, accountId, amount } = payload;
    if (!customerId || !accountId || typeof amount !== 'number') {
      return NextResponse.json({ success: false, error: 'Malformed payment link' }, { status: 400 });
    }

    const body = await request.json();
    const paymentIntentId: string | undefined = body?.paymentIntentId;
    if (!paymentIntentId) {
      return NextResponse.json({ success: false, error: 'paymentIntentId is required' }, { status: 400 });
    }

    const sig = getTokenSignature(token);
    const record = await getPaymentLink(sig);
    if (record?.status === 'paid') {
      return NextResponse.json(
        { success: false, error: 'This payment link has already been used.' },
        { status: 409 }
      );
    }

    const stripe = getStripeForAccount(accountId);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Bind the PI to this token: same customer, same amount.
    const piCustomer = typeof paymentIntent.customer === 'string'
      ? paymentIntent.customer
      : paymentIntent.customer?.id;
    if (piCustomer !== customerId || paymentIntent.amount !== amount) {
      return NextResponse.json({ success: false, error: 'Payment mismatch' }, { status: 400 });
    }
    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json(
        { success: false, error: `Payment not completed. Status: ${paymentIntent.status}` },
        { status: 400 }
      );
    }

    const { invoicesPaid } = await distributePayment({
      stripe,
      paymentIntent,
      customerId,
      invoiceUID,
      amount,
      reason: 'Payment link',
      applyToAll: true,
    });

    await markPaymentLinkPaid(sig, paymentIntent.id);

    return NextResponse.json({
      success: true,
      data: { paymentIntentId: paymentIntent.id, amountPaid: amount, invoicesPaid },
    });
  } catch (error) {
    console.error('Error finalizing pay-link:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to finalize payment' },
      { status: 500 }
    );
  }
}
