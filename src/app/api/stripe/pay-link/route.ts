import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { verifyToken, getTokenSignature } from '@/lib/auth';
import { distributePayment } from '@/lib/payNowCore';
import { claimPaymentLink, markPaymentLinkPaid, getPaymentLink } from '@/lib/paymentLinks';

// Customer-facing single-use payment. SECURITY: the chargeable values
// (customerId, accountId, amount) come ONLY from the signed payment_link token,
// never from the request body. The body may only carry the payment method the
// customer just selected/entered (a paymentMethodId can only charge its own
// customer for this token's amount).

interface PayLinkResult {
  paymentIntentId: string;
  amountPaid: number;
  invoicesPaid: Array<{ invoiceId: string; invoiceNumber: string | null; amountApplied: number }>;
}

interface Requires3DSResponse {
  success: true;
  data: { requiresAction: true; clientSecret: string | null; paymentIntentId: string };
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PayLinkResult> | Requires3DSResponse>> {
  try {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ success: false, error: 'Missing token' }, { status: 401 });
    }

    // Re-verify the token server-side (defense in depth; don't trust middleware headers alone).
    const payload = verifyToken(token);
    if (!payload || payload.kind !== 'payment_link') {
      return NextResponse.json({ success: false, error: 'Invalid payment link' }, { status: 401 });
    }

    const { customerId, invoiceUID, accountId, amount } = payload;
    if (!customerId || !accountId || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ success: false, error: 'Malformed payment link' }, { status: 400 });
    }

    // Body: only the payment method + whether to save it.
    const body = await request.json();
    const paymentMethodId: string | undefined = body?.paymentMethodId;
    const saveCard: boolean = !!body?.saveCard;
    if (!paymentMethodId) {
      return NextResponse.json({ success: false, error: 'paymentMethodId is required' }, { status: 400 });
    }

    const sig = getTokenSignature(token);

    // Single-use gate: reject if this link was already paid.
    const claimed = await claimPaymentLink(sig, {
      customerId,
      accountId,
      invoiceUID,
      amount,
      createdAt: (payload.iat || 0) * 1000,
    });
    if (!claimed) {
      return NextResponse.json(
        { success: false, error: 'This payment link has already been used.' },
        { status: 409 }
      );
    }

    const stripe = getStripeForAccount(accountId);

    if (saveCard) {
      try {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      } catch (attachError) {
        console.log('Payment method attachment:', attachError);
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount, // from the signed token, never the body
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      setup_future_usage: saveCard ? 'off_session' : undefined,
      metadata: {
        reason: 'Payment link',
        InvoiceUID: invoiceUID,
        payNow: 'true',
        payLink: 'true',
        cardSaved: saveCard ? 'true' : 'false',
      },
    });

    // 3DS required: hand the client secret back. The link stays 'pending' (not yet
    // paid) so finalize can complete it. A failed 3DS simply leaves it retryable.
    if (paymentIntent.status === 'requires_action') {
      return NextResponse.json({
        success: true,
        data: {
          requiresAction: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
        },
      });
    }

    if (paymentIntent.status !== 'succeeded') {
      return NextResponse.json(
        { success: false, error: `Payment failed with status: ${paymentIntent.status}` },
        { status: 400 }
      );
    }

    // Charge succeeded — distribute to invoices and mark the link consumed.
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
    console.error('Error processing pay-link:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to process payment' },
      { status: 500 }
    );
  }
}

// GET: lightweight status check used by the /pay page to detect an already-used link.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ success: false, error: 'Missing token' }, { status: 401 });
  const payload = verifyToken(token);
  if (!payload || payload.kind !== 'payment_link') {
    return NextResponse.json({ success: false, error: 'Invalid payment link' }, { status: 401 });
  }
  const record = await getPaymentLink(getTokenSignature(token));
  return NextResponse.json({
    success: true,
    data: { alreadyPaid: record?.status === 'paid', amount: payload.amount },
  });
}
