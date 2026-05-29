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

    // C3 — bind the PI to THIS link, not just to the customer+amount. The PI must
    // be the one this link created (payLinkSig stamped at creation), belong to the
    // token's customer, and match the signed amount. This blocks finalizing some
    // other, unrelated succeeded PaymentIntent of the same amount.
    const piCustomer = typeof paymentIntent.customer === 'string'
      ? paymentIntent.customer
      : paymentIntent.customer?.id;
    if (
      paymentIntent.metadata?.payLinkSig !== sig ||
      piCustomer !== customerId ||
      paymentIntent.amount !== amount
    ) {
      return NextResponse.json({ success: false, error: 'Payment could not be verified.' }, { status: 400 });
    }
    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json(
        { success: false, error: 'Your payment was not completed. Please try again.' },
        { status: 400 }
      );
    }

    // Mark consumed first (prevents any re-charge), then distribute.
    await markPaymentLinkPaid(sig, paymentIntent.id);

    let invoicesPaid: Awaited<ReturnType<typeof distributePayment>>['invoicesPaid'] = [];
    try {
      ({ invoicesPaid } = await distributePayment({
        stripe,
        paymentIntent,
        customerId,
        invoiceUID,
        amount,
        reason: 'Payment link',
        applyToAll: true,
      }));
    } catch (distErr) {
      console.error('pay-link finalize: paid but distribution failed', {
        paymentIntentId: paymentIntent.id, sig, error: distErr,
      });
    }

    return NextResponse.json({
      success: true,
      data: { paymentIntentId: paymentIntent.id, amountPaid: amount, invoicesPaid },
    });
  } catch (error) {
    console.error('Error finalizing pay-link:', error);
    return NextResponse.json(
      { success: false, error: 'We could not finalize your payment. Please contact us.' },
      { status: 500 }
    );
  }
}
