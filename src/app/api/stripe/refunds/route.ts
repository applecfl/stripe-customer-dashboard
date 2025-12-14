import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeForAccount } from '@/lib/stripe';
import { RefundData, ApiResponse } from '@/types';

// Get refunds for a customer
export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<RefundData[]>>> {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const accountId = searchParams.get('accountId');

    if (!customerId) {
      return NextResponse.json(
        { success: false, error: 'customerId is required' },
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

    // Get payment intents for the customer first
    const paymentIntents = await stripe.paymentIntents.list({
      customer: customerId,
      limit: 100,
    });

    // Get refunds for each payment intent
    const refunds: RefundData[] = [];

    for (const pi of paymentIntents.data) {
      const piRefunds = await stripe.refunds.list({
        payment_intent: pi.id,
        limit: 100,
      });

      for (const refund of piRefunds.data) {
        refunds.push({
          id: refund.id,
          amount: refund.amount,
          currency: refund.currency,
          status: refund.status || 'unknown',
          created: refund.created,
          payment_intent: typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id || '',
          reason: refund.reason,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: refunds,
    });
  } catch (error) {
    console.error('Error fetching refunds:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch refunds' },
      { status: 500 }
    );
  }
}

// Create a refund
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<RefundData>>> {
  try {
    const body = await request.json();
    const { paymentIntentId, amount, reason, note, accountId } = body;

    if (!paymentIntentId) {
      return NextResponse.json(
        { success: false, error: 'paymentIntentId is required' },
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

    // Create the refund
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
    };

    // Add optional parameters
    if (amount) {
      refundParams.amount = amount;
    }

    if (reason && ['duplicate', 'fraudulent', 'requested_by_customer'].includes(reason)) {
      refundParams.reason = reason as 'duplicate' | 'fraudulent' | 'requested_by_customer';
    }

    // Add note to metadata if provided
    if (note) {
      refundParams.metadata = {
        internal_note: note,
      };
    }

    const refund = await stripe.refunds.create(refundParams);

    // Update payment intent metadata to mark as refunded
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: {
        refunded: 'true',
        refundId: refund.id,
        refundedAt: Date.now().toString(),
        ...(note && { refundNote: note }),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: refund.id,
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status || 'unknown',
        created: refund.created,
        payment_intent: paymentIntentId,
        reason: refund.reason,
      },
    });
  } catch (error) {
    console.error('Error creating refund:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create refund' },
      { status: 500 }
    );
  }
}
