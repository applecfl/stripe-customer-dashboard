import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import stripe from '@/lib/stripe';
import { PaymentData, ApiResponse } from '@/types';

// Get payments for customer
export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PaymentData[]>>> {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const invoiceUID = searchParams.get('invoiceUID');

    if (!customerId) {
      return NextResponse.json(
        { success: false, error: 'customerId is required' },
        { status: 400 }
      );
    }

    // Get ALL payment intents for the customer (handle pagination)
    const allPaymentIntents: Stripe.PaymentIntent[] = [];
    let hasMorePIs = true;
    let piStartingAfter: string | undefined;

    while (hasMorePIs) {
      const piParams: Stripe.PaymentIntentListParams = {
        customer: customerId,
        limit: 100,
      };
      if (piStartingAfter) {
        piParams.starting_after = piStartingAfter;
      }

      const piPage = await stripe.paymentIntents.list(piParams);
      allPaymentIntents.push(...piPage.data);
      hasMorePIs = piPage.has_more;
      if (piPage.data.length > 0) {
        piStartingAfter = piPage.data[piPage.data.length - 1].id;
      }
    }

    console.log('Total payment intents found:', allPaymentIntents.length);

    // Get ALL invoices for mapping invoice numbers and payment intents (handle pagination)
    const allInvoices: Stripe.Invoice[] = [];
    let hasMoreInvoices = true;
    let invoiceStartingAfter: string | undefined;

    while (hasMoreInvoices) {
      const invoiceParams: Stripe.InvoiceListParams = {
        customer: customerId,
        limit: 100,
      };
      if (invoiceStartingAfter) {
        invoiceParams.starting_after = invoiceStartingAfter;
      }

      const invoicesPage = await stripe.invoices.list(invoiceParams);
      allInvoices.push(...invoicesPage.data);
      hasMoreInvoices = invoicesPage.has_more;
      if (invoicesPage.data.length > 0) {
        invoiceStartingAfter = invoicesPage.data[invoicesPage.data.length - 1].id;
      }
    }

    const invoiceMap = new Map(allInvoices.map((inv) => [inv.id, inv]));

    // Create a map of payment intent IDs to invoice IDs
    const paymentIntentToInvoice = new Map<string, string>();
    allInvoices.forEach((inv) => {
      // Use type assertion since payment_intent exists on Invoice but may not be in all type definitions
      const paymentIntent = (inv as unknown as { payment_intent?: string | { id: string } | null }).payment_intent;
      if (paymentIntent) {
        const piId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id;
        paymentIntentToInvoice.set(piId, inv.id);
      }
    });

    // Get refunds for all payment intents that have been refunded
    const refundedPIs = allPaymentIntents.filter(pi => pi.metadata?.refunded === 'true');
    const refundMap = new Map<string, { amount: number; reason: string | null }>();

    for (const pi of refundedPIs) {
      try {
        const refunds = await stripe.refunds.list({
          payment_intent: pi.id,
          limit: 10,
        });
        if (refunds.data.length > 0) {
          // Sum up all refund amounts and get the first reason
          const totalRefunded = refunds.data.reduce((sum, r) => sum + r.amount, 0);
          const reason = refunds.data[0].reason;
          refundMap.set(pi.id, { amount: totalRefunded, reason });
        }
      } catch (e) {
        console.error(`Error fetching refunds for ${pi.id}:`, e);
      }
    }

    let payments: PaymentData[] = allPaymentIntents.map((pi) => {
      // Check multiple sources for invoice linkage:
      // 1. Direct invoiceId in metadata
      // 2. Stripe's native payment_intent -> invoice mapping
      // 3. Pay Now flow: invoicesPaid metadata (comma-separated list)
      // 4. Pay Now flow: selectedInvoiceIds metadata (comma-separated list)
      let invoiceId = pi.metadata?.invoiceId || paymentIntentToInvoice.get(pi.id) || null;

      // For Pay Now payments, get the first invoice from invoicesPaid
      if (!invoiceId && pi.metadata?.invoicesPaid) {
        const paidInvoices = pi.metadata.invoicesPaid.split(',').filter(Boolean);
        if (paidInvoices.length > 0) {
          invoiceId = paidInvoices[0];
        }
      }

      // Fallback to selectedInvoiceIds if still no invoice found
      if (!invoiceId && pi.metadata?.selectedInvoiceIds) {
        const selectedInvoices = pi.metadata.selectedInvoiceIds.split(',').filter(Boolean);
        if (selectedInvoices.length > 0) {
          invoiceId = selectedInvoices[0];
        }
      }

      const invoice = invoiceId ? invoiceMap.get(invoiceId) : null;

      // Build invoice number display - for Pay Now with multiple invoices, show count
      let invoiceNumber = invoice?.number ?? null;
      if (pi.metadata?.invoicesPaid) {
        const paidInvoices = pi.metadata.invoicesPaid.split(',').filter(Boolean);
        if (paidInvoices.length > 1) {
          const firstInvoice = invoiceMap.get(paidInvoices[0]);
          invoiceNumber = firstInvoice?.number
            ? `${firstInvoice.number} (+${paidInvoices.length - 1} more)`
            : `${paidInvoices.length} invoices`;
        }
      }

      // Get refund info if available
      const refundInfo = refundMap.get(pi.id);

      return {
        id: pi.id,
        amount: pi.amount,
        amount_refunded: refundInfo?.amount ?? (pi.amount - (pi.amount_received || 0)),
        currency: pi.currency,
        status: pi.status,
        created: pi.created,
        invoice: invoiceId,
        invoiceNumber,
        payment_method_types: pi.payment_method_types,
        refunded: pi.metadata?.refunded === 'true',
        metadata: pi.metadata || {},
        customer: typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null,
        description: pi.description ?? null,
        refund_reason: refundInfo?.reason ?? null,
      };
    });

    // Filter by invoiceUID if provided (check both cases for metadata key)
    if (invoiceUID) {
      const invoiceUIDInvoices = allInvoices
        .filter((inv) => inv.metadata?.invoiceUID === invoiceUID || inv.metadata?.InvoiceUID === invoiceUID)
        .map((inv) => inv.id);

      payments = payments.filter((p) => {
        // Include if payment is connected to an invoice with this InvoiceUID
        if (p.invoice && invoiceUIDInvoices.includes(p.invoice)) {
          return true;
        }
        // Also include if payment has InvoiceUID directly in its metadata (e.g., Pay Now payments)
        if (p.metadata?.InvoiceUID === invoiceUID || p.metadata?.invoiceUID === invoiceUID) {
          return true;
        }
        return false;
      });
    }

    return NextResponse.json({
      success: true,
      data: payments,
    });
  } catch (error) {
    console.error('Error fetching payments:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch payments' },
      { status: 500 }
    );
  }
}

// Create one-time payment (without saving card)
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PaymentData>>> {
  try {
    const body = await request.json();
    const { amount, currency, paymentMethodId, customerId, description, saveCard } = body;

    if (!amount || !paymentMethodId) {
      return NextResponse.json(
        { success: false, error: 'amount and paymentMethodId are required' },
        { status: 400 }
      );
    }

    // Create payment intent
    const paymentIntentParams: Parameters<typeof stripe.paymentIntents.create>[0] = {
      amount,
      currency: currency || 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      description,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      metadata: {
        oneTimePayment: 'true',
      },
    };

    // Only attach to customer if customerId provided
    if (customerId) {
      paymentIntentParams.customer = customerId;

      // If saving card, set it up for future use
      if (saveCard) {
        paymentIntentParams.setup_future_usage = 'off_session';
      }
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    return NextResponse.json({
      success: true,
      data: {
        id: paymentIntent.id,
        amount: paymentIntent.amount,
        amount_refunded: 0,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        created: paymentIntent.created,
        invoice: null,
        invoiceNumber: null,
        payment_method_types: paymentIntent.payment_method_types,
        refunded: false,
        metadata: paymentIntent.metadata || {},
        customer: typeof paymentIntent.customer === 'string' ? paymentIntent.customer : paymentIntent.customer?.id || null,
        description: paymentIntent.description,
        refund_reason: null,
      },
    });
  } catch (error) {
    console.error('Error creating payment:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create payment' },
      { status: 500 }
    );
  }
}
