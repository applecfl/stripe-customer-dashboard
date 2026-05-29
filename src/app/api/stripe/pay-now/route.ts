import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { distributePayment } from '@/lib/payNowCore';

interface PayNowResult {
  paymentIntentId: string;
  amountPaid: number;
  invoicesPaid: Array<{
    invoiceId: string;
    invoiceNumber: string | null;
    amountApplied: number;
  }>;
  creditAdded: number;
}

// Response type for 3DS authentication required
interface Requires3DSResponse {
  success: true;
  data: {
    requiresAction: true;
    clientSecret: string | null;
    paymentIntentId: string;
  };
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PayNowResult> | Requires3DSResponse>> {
  try {
    const body = await request.json();
    const {
      customerId,
      paymentMethodId,
      amount,
      currency,
      reason,
      invoiceUID,
      selectedInvoiceIds,
      applyToAll,
      saveCard,
      accountId,
    } = body;

    if (!customerId || !paymentMethodId || !amount) {
      return NextResponse.json(
        { success: false, error: 'customerId, paymentMethodId, and amount are required' },
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

    // If saveCard is true, attach the payment method to the customer first
    if (saveCard) {
      try {
        // Attach payment method to customer
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: customerId,
        });
      } catch (attachError) {
        // Might already be attached, which is fine
        console.log('Payment method attachment:', attachError);
      }
    }

    // Create the payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: currency || 'usd',
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      setup_future_usage: saveCard ? 'off_session' : undefined,
      metadata: {
        reason,
        InvoiceUID: invoiceUID,
        payNow: 'true',
        selectedInvoiceIds: selectedInvoiceIds ? selectedInvoiceIds.join(',') : '',
        cardSaved: saveCard ? 'true' : 'false',
      },
    });

    // Handle 3DS authentication required
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

    // Distribute the succeeded payment across the customer's invoices.
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
    console.error('Error processing pay now:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to process payment' },
      { status: 500 }
    );
  }
}
