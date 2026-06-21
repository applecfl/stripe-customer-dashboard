import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { verifyToken, getTokenSignature } from '@/lib/auth';
import { distributePayment } from '@/lib/payNowCore';
import { commitPayment } from '@/lib/paymentLinks';

interface FinalizeResult {
  paymentIntentId: string;
  amountPaid: number;
  remaining: number;
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

    const { customerId, invoiceUID, accountId } = payload;
    if (!customerId || !accountId) {
      return NextResponse.json({ success: false, error: 'Malformed payment link' }, { status: 400 });
    }

    const body = await request.json();
    const paymentIntentId: string | undefined = body?.paymentIntentId;
    if (!paymentIntentId) {
      return NextResponse.json({ success: false, error: 'paymentIntentId is required' }, { status: 400 });
    }

    const sig = getTokenSignature(token);
    const stripe = getStripeForAccount(accountId);
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // C3 — bind the PI to THIS link: it must carry this link's payLinkSig (stamped at
    // creation) and belong to the token's customer. The charge amount was capped
    // server-side at creation, so sig+customer is the authoritative bind.
    const piCustomer = typeof paymentIntent.customer === 'string'
      ? paymentIntent.customer
      : paymentIntent.customer?.id;
    if (paymentIntent.metadata?.payLinkSig !== sig || piCustomer !== customerId) {
      return NextResponse.json({ success: false, error: 'Payment could not be verified.' }, { status: 400 });
    }
    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json(
        { success: false, error: 'Your payment was not completed. Please try again.' },
        { status: 400 }
      );
    }

    const amount = paymentIntent.amount;

    // Decrement the link's remaining counter (idempotent per PI), then distribute.
    const remaining = await commitPayment(sig, paymentIntent.id, amount);

    let invoicesPaid: Awaited<ReturnType<typeof distributePayment>>['invoicesPaid'] = [];
    try {
      ({ invoicesPaid } = await distributePayment({
        stripe, paymentIntent, customerId, invoiceUID, amount,
        reason: 'Payment link', applyToAll: true,
      }));
    } catch (distErr) {
      console.error('pay-link finalize: paid but distribution failed', {
        paymentIntentId: paymentIntent.id, sig, error: distErr,
      });
    }

    return NextResponse.json({
      success: true,
      data: { paymentIntentId: paymentIntent.id, amountPaid: amount, remaining, invoicesPaid },
    });
  } catch (error) {
    console.error('Error finalizing pay-link:', error);
    return NextResponse.json(
      { success: false, error: 'We could not finalize your payment. Please contact us.' },
      { status: 500 }
    );
  }
}
