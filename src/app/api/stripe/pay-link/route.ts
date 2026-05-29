import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { verifyToken, getTokenSignature } from '@/lib/auth';
import { distributePayment } from '@/lib/payNowCore';
import { claimPaymentLink, markPaymentLinkPaid, getPaymentLink, recordPaymentIntent } from '@/lib/paymentLinks';

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

    // Body: only the payment method + save flag. Chargeable values never come from
    // here. NOTE: we do NOT trust any client "isNewCard" flag — we determine new vs
    // saved server-side from the PM's actual owner.
    const body = await request.json();
    const paymentMethodId: string | undefined = body?.paymentMethodId;
    const saveCard: boolean = !!body?.saveCard;
    if (!paymentMethodId || typeof paymentMethodId !== 'string') {
      return NextResponse.json({ success: false, error: 'A payment method is required' }, { status: 400 });
    }

    const sig = getTokenSignature(token);
    const stripe = getStripeForAccount(accountId);

    // C2 — payment-method ownership, enforced server-side regardless of client flags.
    // Retrieve the PM and inspect its owner:
    //  - attached to THIS customer  -> a saved card, allowed
    //  - unattached (customer null) -> a freshly tokenized new card, allowed
    //  - attached to ANOTHER customer -> reject (can't charge someone else's card)
    let pmOwner: string | null = null;
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      pmOwner = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id ?? null;
    } catch {
      return NextResponse.json(
        { success: false, error: 'Selected payment method is not available.' },
        { status: 400 }
      );
    }
    if (pmOwner !== null && pmOwner !== customerId) {
      return NextResponse.json(
        { success: false, error: 'Selected payment method is not available.' },
        { status: 400 }
      );
    }
    const isNewCard = pmOwner === null; // unattached => new card

    // H2 — idempotency: if a PaymentIntent for this link already succeeded (e.g. a
    // prior attempt charged but failed to mark paid), do not charge again.
    const existing = await getPaymentLink(sig);
    if (existing?.status === 'paid') {
      return NextResponse.json(
        { success: false, error: 'This payment link has already been used.' },
        { status: 409 }
      );
    }
    if (existing?.paymentIntentId) {
      const priorPi = await stripe.paymentIntents.retrieve(existing.paymentIntentId);
      if (priorPi.status === 'succeeded') {
        await markPaymentLinkPaid(sig, priorPi.id);
        return NextResponse.json(
          { success: false, error: 'This payment link has already been used.' },
          { status: 409 }
        );
      }
    }

    // Single-use gate (atomic): reject if already paid; claim otherwise.
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

    // Only attach a card to the customer when saving a NEW card.
    if (isNewCard && saveCard) {
      try {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      } catch (attachError) {
        console.log('Payment method attachment failed (non-fatal):', attachError);
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount, // from the signed token, never the body
      currency: 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      setup_future_usage: isNewCard && saveCard ? 'off_session' : undefined,
      metadata: {
        reason: 'Payment link',
        InvoiceUID: invoiceUID,
        payNow: 'true',
        payLink: 'true',
        payLinkSig: sig, // C3 — bind this PI to this exact link for finalize.
        cardSaved: isNewCard && saveCard ? 'true' : 'false',
      },
    }, {
      // H2 — concurrency guard: two simultaneous submits of THIS link with THIS card
      // collapse to a single PaymentIntent instead of charging twice. A retry with a
      // different card (e.g. after a decline) uses a different key and is allowed.
      idempotencyKey: `paylink_${sig}_${paymentMethodId}`,
    });

    // Record the PI on the link doc immediately so a later success-without-markPaid
    // can be reconciled on retry (H2).
    await recordPaymentIntent(sig, paymentIntent.id);

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
      // Generic message — don't leak Stripe internals to the customer.
      return NextResponse.json(
        { success: false, error: 'Your payment could not be completed. Please try another card.' },
        { status: 400 }
      );
    }

    // Charge succeeded — mark consumed FIRST (so any later failure can never lead to
    // a second charge), then distribute to invoices. A distribution hiccup is logged
    // and reconciled out-of-band; the money has moved and the link is spent.
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
      console.error('pay-link: charge succeeded but invoice distribution failed', {
        paymentIntentId: paymentIntent.id, sig, error: distErr,
      });
    }

    return NextResponse.json({
      success: true,
      data: { paymentIntentId: paymentIntent.id, amountPaid: amount, invoicesPaid },
    });
  } catch (error) {
    // Log full detail server-side; return a generic message to the customer.
    console.error('Error processing pay-link:', error);
    return NextResponse.json(
      { success: false, error: 'We could not process your payment. Please try again.' },
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
