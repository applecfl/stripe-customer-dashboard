import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { verifyToken, getTokenSignature } from '@/lib/auth';
import { getOrInitLink, getChargeableAmount, commitPayment } from '@/lib/paymentLinks';

// Customer-facing payment link with a simple decrementing counter. The link's fixed
// amount is signed into the token (from outstanding OR a custom value). On first view
// remaining = amount; each payment decrements remaining until it hits 0 (paid in
// full). SECURITY: customerId/accountId/amount come ONLY from the signed token; the
// body may only carry the payment method + the amount the customer chose to pay now
// (capped server-side at remaining).

interface PayLinkResult {
  paymentIntentId: string;
  amountPaid: number;
  remaining: number;
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

    const { customerId, invoiceUID, accountId } = payload;
    if (!customerId || !accountId || typeof payload.amount !== 'number' || payload.amount <= 0) {
      return NextResponse.json({ success: false, error: 'Malformed payment link' }, { status: 400 });
    }
    const linkAmount = payload.amount;

    // Body: payment method + save flag + the amount the customer chose to pay now.
    // We do NOT trust a client "isNewCard" flag — new vs saved is determined from the
    // PM's real owner. The charge is capped server-side at the link's remaining.
    const body = await request.json();
    const paymentMethodId: string | undefined = body?.paymentMethodId;
    const saveCard: boolean = !!body?.saveCard;
    const requestedAmount: number | undefined =
      typeof body?.amount === 'number' ? Math.round(body.amount) : undefined;
    if (!paymentMethodId || typeof paymentMethodId !== 'string') {
      return NextResponse.json({ success: false, error: 'A payment method is required' }, { status: 400 });
    }

    const sig = getTokenSignature(token);
    const stripe = getStripeForAccount(accountId);

    // Initialise the counter on first view (remaining = link amount), then cap the
    // charge at what's still remaining. No live Stripe-balance lookup.
    await getOrInitLink(sig, { customerId, accountId, invoiceUID, amount: linkAmount });
    const want = requestedAmount && requestedAmount > 0 ? requestedAmount : Number.MAX_SAFE_INTEGER;
    const amount = await getChargeableAmount(sig, want);
    if (amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'This balance has already been paid in full.' },
        { status: 409 }
      );
    }

    // C2 — payment-method ownership, enforced server-side regardless of client flags.
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

    // Only attach a card to the customer when saving a NEW card.
    if (isNewCard && saveCard) {
      try {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      } catch (attachError) {
        console.log('Payment method attachment failed (non-fatal):', attachError);
      }
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount, // capped at the link's remaining counter
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
      // Concurrency guard: two simultaneous submits of the SAME link+card+amount
      // collapse to one PaymentIntent. A retry with a different card/amount differs.
      idempotencyKey: `paylink_${sig}_${paymentMethodId}_${amount}`,
    });

    // 3DS required: hand the client secret back. The counter is decremented only in
    // finalize after the charge actually succeeds.
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
        { success: false, error: 'Your payment could not be completed. Please try another card.' },
        { status: 400 }
      );
    }

    // Charge succeeded — decrement the link's counter (idempotent per PI). This is a
    // STANDALONE office payment request, NOT tied to a specific Stripe invoice, so we
    // deliberately do NOT run distributePayment / touch the customer's other open or
    // draft invoices (per Sholem's directive — see Bejman bug). The PaymentIntent
    // carries InvoiceUID in metadata for downstream reconciliation; the Firestore
    // counter tracks the remaining balance on this link.
    const remaining = await commitPayment(sig, paymentIntent.id, amount);

    return NextResponse.json({
      success: true,
      data: { paymentIntentId: paymentIntent.id, amountPaid: amount, remaining, invoicesPaid: [] },
    });
  } catch (error) {
    console.error('Error processing pay-link:', error);
    return NextResponse.json(
      { success: false, error: 'We could not process your payment. Please try again.' },
      { status: 500 }
    );
  }
}

// GET: status for the /pay page — returns the link's remaining counter (initialising
// it to the signed amount on first view). No live Stripe-balance lookup.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ success: false, error: 'Missing token' }, { status: 401 });
  const payload = verifyToken(token);
  if (!payload || payload.kind !== 'payment_link' || typeof payload.amount !== 'number') {
    return NextResponse.json({ success: false, error: 'Invalid payment link' }, { status: 401 });
  }

  const sig = getTokenSignature(token);
  const rec = await getOrInitLink(sig, {
    customerId: payload.customerId,
    accountId: payload.accountId,
    invoiceUID: payload.invoiceUID,
    amount: payload.amount,
  });
  return NextResponse.json({
    success: true,
    data: { remaining: rec.remaining, amount: rec.amount, alreadyPaid: rec.remaining <= 0 },
  });
}
