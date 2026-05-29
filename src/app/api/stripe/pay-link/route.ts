import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { verifyToken, getTokenSignature } from '@/lib/auth';
import { distributePayment } from '@/lib/payNowCore';
import { getOutstandingForUID } from '@/lib/balance';
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

    const { customerId, invoiceUID, accountId } = payload;
    const isDynamic = payload.dynamic === true;
    if (!customerId || !accountId) {
      return NextResponse.json({ success: false, error: 'Malformed payment link' }, { status: 400 });
    }
    // Fixed links carry a signed amount; dynamic links don't (computed live below).
    if (!isDynamic && (typeof payload.amount !== 'number' || payload.amount <= 0)) {
      return NextResponse.json({ success: false, error: 'Malformed payment link' }, { status: 400 });
    }

    // Body: payment method + save flag, and (dynamic only) the amount the customer
    // chose. Chargeable amount is still authoritative server-side: fixed=from token,
    // dynamic=capped at the live outstanding balance. We do NOT trust a client
    // "isNewCard" flag — new vs saved is determined from the PM's real owner.
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

    // Resolve the authoritative charge amount.
    let amount: number;
    if (isDynamic) {
      const outstanding = await getOutstandingForUID(stripe, customerId, invoiceUID);
      if (outstanding <= 0) {
        return NextResponse.json(
          { success: false, error: 'This balance has already been paid in full.' },
          { status: 409 }
        );
      }
      // Customer may pay any positive amount up to the live balance; default to full.
      amount = requestedAmount && requestedAmount > 0 ? requestedAmount : outstanding;
      if (amount > outstanding) {
        return NextResponse.json(
          { success: false, error: 'Amount exceeds the outstanding balance.' },
          { status: 400 }
        );
      }
    } else {
      amount = payload.amount as number;
    }

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

    // Single-use vs. dynamic gating:
    //  - FIXED link: classic single-use. Reject if already paid; reconcile a prior
    //    succeeded-but-unmarked PI; otherwise atomically claim.
    //  - DYNAMIC link: the live balance (checked above) IS the gate — it stays usable
    //    until the balance hits zero, so we don't block on a prior payment. Concurrency
    //    is still guarded by the per-(sig,pm,amount) Stripe idempotency key below.
    if (!isDynamic) {
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
      const claimed = await claimPaymentLink(sig, {
        customerId, accountId, invoiceUID, amount,
        createdAt: (payload.iat || 0) * 1000,
      });
      if (!claimed) {
        return NextResponse.json(
          { success: false, error: 'This payment link has already been used.' },
          { status: 409 }
        );
      }
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
      amount, // authoritative: fixed=from token, dynamic=capped at live balance
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
        payLinkDynamic: isDynamic ? 'true' : 'false',
        cardSaved: isNewCard && saveCard ? 'true' : 'false',
      },
    }, {
      // H2 — concurrency guard: two simultaneous submits of the SAME link+card+amount
      // collapse to one PaymentIntent. For dynamic links the amount is in the key so a
      // later partial payment of a different amount is allowed; a retry with a
      // different card uses a different key too.
      idempotencyKey: `paylink_${sig}_${paymentMethodId}_${amount}`,
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

    // Charge succeeded.
    // FIXED link: mark consumed FIRST (so any later failure can't cause a re-charge),
    // then distribute. DYNAMIC link: there is no "consumed" flag — the live balance is
    // the source of truth — so just distribute (which reduces the balance for next
    // time). Distribution errors are logged for out-of-band reconciliation.
    if (!isDynamic) {
      await markPaymentLinkPaid(sig, paymentIntent.id);
    }

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

// GET: status for the /pay page. For dynamic links returns the live outstanding
// balance; for fixed links returns the signed amount + whether it's been used.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.json({ success: false, error: 'Missing token' }, { status: 401 });
  const payload = verifyToken(token);
  if (!payload || payload.kind !== 'payment_link') {
    return NextResponse.json({ success: false, error: 'Invalid payment link' }, { status: 401 });
  }

  if (payload.dynamic === true) {
    try {
      const stripe = getStripeForAccount(payload.accountId);
      const outstanding = await getOutstandingForUID(stripe, payload.customerId, payload.invoiceUID);
      return NextResponse.json({
        success: true,
        data: { dynamic: true, outstanding, alreadyPaid: outstanding <= 0 },
      });
    } catch {
      return NextResponse.json({ success: false, error: 'Unable to load balance' }, { status: 500 });
    }
  }

  const record = await getPaymentLink(getTokenSignature(token));
  return NextResponse.json({
    success: true,
    data: { dynamic: false, alreadyPaid: record?.status === 'paid', amount: payload.amount },
  });
}
