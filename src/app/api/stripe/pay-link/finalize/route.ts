import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { verifyToken, getTokenSignature } from '@/lib/auth';
import { commitPayment } from '@/lib/paymentLinks';
import { schedulePlanRemainder } from '@/lib/plan';

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

    const { customerId, accountId } = payload;
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

    // Plan path (3DS): the first installment succeeded. Schedule installments #2..N via the
    // existing engine. Idempotent (guarded in schedulePlanRemainder), so it's safe even if
    // the non-3DS route already scheduled. Anchor dates to the PI's creation time so they
    // match whatever was previewed/created in the POST route.
    if (paymentIntent.metadata?.plan === 'true') {
      const planCount = parseInt(paymentIntent.metadata.planCount || '0', 10);
      if (planCount >= 2) {
        const sched = await schedulePlanRemainder(sig, payload, paymentIntent, planCount, paymentIntent.created);
        return NextResponse.json({
          success: true,
          data: {
            paymentIntentId: paymentIntent.id,
            amountPaid: amount,
            remaining: 0,
            invoicesPaid: [],
            plan: { count: planCount, scheduledRemainder: sched.scheduled, scheduleError: sched.error ?? null },
          },
        });
      }
    }

    // Decrement the link's counter only. Standalone payment request — do NOT run
    // distributePayment / touch the customer's invoices (per Sholem's directive).
    const remaining = await commitPayment(sig, paymentIntent.id, amount);

    return NextResponse.json({
      success: true,
      data: { paymentIntentId: paymentIntent.id, amountPaid: amount, remaining, invoicesPaid: [] },
    });
  } catch (error) {
    console.error('Error finalizing pay-link:', error);
    return NextResponse.json(
      { success: false, error: 'We could not finalize your payment. Please contact us.' },
      { status: 500 }
    );
  }
}
