import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeForAccount } from '@/lib/stripe';
import { PaymentData, ApiResponse } from '@/types';

// Get payments for customer
export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PaymentData[]>>> {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');
    const invoiceUID = searchParams.get('invoiceUID');
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

    // Type for accessing raw Stripe invoice properties that may not be in TypeScript types
    // These fields exist on the Stripe API response but aren't in the TypeScript definitions
    type RawInvoice = Stripe.Invoice & {
      payment_intent?: string | Stripe.PaymentIntent | null;
      charge?: string | Stripe.Charge | null;
      paid_out_of_band?: boolean;
    };

    // For paid invoices, we need to retrieve them individually to get payment_intent and charge
    // because these fields are not returned in the list endpoint
    const paidInvoices = allInvoices.filter(inv => inv.status === 'paid');
    console.log(`Found ${paidInvoices.length} paid invoices, fetching details...`);

    // Fetch detailed invoice data for paid invoices
    // We need to get payment info from the 'payments' field (newer API) or via charges list
    const paidInvoiceDetails = new Map<string, RawInvoice>();

    // Extended type to include 'payments' field from newer Stripe API
    type InvoicePaymentObject = {
      id: string;
      payment?: {
        id: string;
        object: string;
        payment_intent?: string;
        charge?: string;
      } | string;
      amount_paid?: number;
      status?: string;
    };

    type ExtendedRawInvoice = RawInvoice & {
      payments?: {
        data?: InvoicePaymentObject[];
      };
    };

    // Map to store extracted payment info from invoice payments
    const invoicePaymentInfo = new Map<string, { paymentIntentId: string | null; chargeId: string | null; amount: number }>();

    await Promise.all(
      paidInvoices.map(async (inv) => {
        try {
          const detailed = await stripe.invoices.retrieve(inv.id, {
            expand: ['payments.data.payment'],
          });
          const extendedInv = detailed as ExtendedRawInvoice;

          // Extract payment info from the payments array (newer Stripe API)
          const paymentsData = extendedInv.payments?.data;
          if (paymentsData && paymentsData.length > 0) {
            const firstPayment = paymentsData[0];
            const paymentObj = firstPayment.payment;

            if (paymentObj && typeof paymentObj !== 'string') {
              const piId = paymentObj.payment_intent || null;
              const chargeId = paymentObj.charge || null;
              console.log(`Invoice ${inv.id}: extracted from payments - pi=${piId}, charge=${chargeId}`);
              invoicePaymentInfo.set(inv.id, {
                paymentIntentId: piId,
                chargeId: chargeId,
                amount: firstPayment.amount_paid || inv.amount_paid,
              });
            }
          }

          // Debug: log raw response fields including 'payments'
          console.log(`Invoice ${inv.id} raw fields:`, {
            payment_intent: extendedInv.payment_intent,
            charge: extendedInv.charge,
            paid_out_of_band: extendedInv.paid_out_of_band,
            status: extendedInv.status,
            hasPaymentsKey: 'payments' in detailed,
            paymentsCount: paymentsData?.length || 0,
            extractedInfo: invoicePaymentInfo.get(inv.id),
          });

          paidInvoiceDetails.set(inv.id, extendedInv);
        } catch (err) {
          console.error(`Error fetching invoice ${inv.id}:`, err);
        }
      })
    );

    console.log(`Extracted payment info for ${invoicePaymentInfo.size} invoices`);

    // Also fetch charges directly for these invoices to find the payment info
    const invoiceCharges = new Map<string, Stripe.Charge>();
    await Promise.all(
      paidInvoices.map(async (inv) => {
        try {
          const charges = await stripe.charges.list({
            limit: 10,
          });
          // Find charge for this invoice
          for (const charge of charges.data) {
            const chargeInvoice = (charge as Stripe.Charge & { invoice?: string }).invoice;
            if (chargeInvoice === inv.id) {
              console.log(`Found charge ${charge.id} for invoice ${inv.id}, pi=${charge.payment_intent}`);
              invoiceCharges.set(inv.id, charge);
              break;
            }
          }
        } catch (err) {
          console.error(`Error fetching charges for invoice ${inv.id}:`, err);
        }
      })
    );

    console.log(`Found ${invoiceCharges.size} charges linked to paid invoices`);

    // Create a map of payment intent IDs to invoice IDs
    // First try from invoicePaymentInfo (extracted from payments array), then from paidInvoiceDetails, then from invoiceCharges
    const paymentIntentToInvoice = new Map<string, string>();

    // From extracted payment info (newer API - payments.data[].payment)
    invoicePaymentInfo.forEach((info, invId) => {
      if (info.paymentIntentId) {
        paymentIntentToInvoice.set(info.paymentIntentId, invId);
        const inv = paidInvoiceDetails.get(invId);
        console.log(`Mapped payment_intent ${info.paymentIntentId} -> invoice ${invId} (${inv?.number}) [from payments array]`);
      }
    });

    // From invoice details (if available - legacy)
    paidInvoiceDetails.forEach((rawInv, invId) => {
      const paymentIntent = rawInv.payment_intent;
      if (paymentIntent && !paymentIntentToInvoice.has(typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id)) {
        const piId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id;
        paymentIntentToInvoice.set(piId, invId);
        console.log(`Mapped payment_intent ${piId} -> invoice ${invId} (${rawInv.number}) [from invoice field]`);
      }
    });

    // From charges (fallback)
    invoiceCharges.forEach((charge, invId) => {
      if (charge.payment_intent && !paymentIntentToInvoice.has(charge.payment_intent as string)) {
        const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent;
        paymentIntentToInvoice.set(piId as string, invId);
        const inv = paidInvoiceDetails.get(invId);
        console.log(`Mapped payment_intent ${piId} -> invoice ${invId} (${inv?.number}) [from charge]`);
      }
    });

    console.log('Invoice to PaymentIntent mappings:', paymentIntentToInvoice.size);
    console.log('Paid invoices with details:', paidInvoiceDetails.size);

    // Debug: log paid invoices with their payment_intent and charge (from detailed fetch)
    paidInvoiceDetails.forEach((rawInv, invId) => {
      const pi = rawInv.payment_intent;
      const charge = rawInv.charge;
      const piId = pi ? (typeof pi === 'string' ? pi : pi.id) : null;
      const chargeId = charge ? (typeof charge === 'string' ? charge : charge.id) : null;
      console.log(`Paid invoice ${rawInv.number || invId}: payment_intent=${piId || 'NONE'}, charge=${chargeId || 'NONE'}, paid_out_of_band=${rawInv.paid_out_of_band ?? 'undefined'}, invoiceUID=${rawInv.metadata?.invoiceUID || rawInv.metadata?.InvoiceUID || 'NONE'}`);
    });

    // Create a set of payment intent IDs we already have in our list
    const fetchedPaymentIntentIds = new Set(allPaymentIntents.map(pi => pi.id));
    console.log(`Fetched ${fetchedPaymentIntentIds.size} payment intents for customer`);

    // Create payments from paid invoices that either:
    // 1. Have a payment_intent that's NOT in our fetched PaymentIntents list (invoice auto-charge)
    // 2. Have only a charge (older Stripe integrations)
    // 3. Are paid out-of-band (manually marked as paid)
    const invoiceBasedPayments: PaymentData[] = [];
    const processedIds = new Set<string>();

    // Use the detailed invoice data we fetched, plus extracted payment info and charges
    paidInvoiceDetails.forEach((rawInv, invId) => {
      // Try to get payment_intent and charge from multiple sources:
      // 1. invoicePaymentInfo (extracted from payments array - newer API)
      // 2. Direct invoice fields (legacy)
      // 3. invoiceCharges (fallback via charges list)
      const extractedInfo = invoicePaymentInfo.get(invId);
      const directCharge = invoiceCharges.get(invId);

      const piId = extractedInfo?.paymentIntentId ||
        (rawInv.payment_intent ? (typeof rawInv.payment_intent === 'string' ? rawInv.payment_intent : rawInv.payment_intent.id) : null) ||
        (directCharge?.payment_intent ? (typeof directCharge.payment_intent === 'string' ? directCharge.payment_intent : null) : null);

      const charge = rawInv.charge || directCharge || null;
      const chargeId = extractedInfo?.chargeId ||
        (charge ? (typeof charge === 'string' ? charge : charge.id) : null);

      // If there's a payment_intent that's already in our fetched list, skip it
      // (it will be handled by the PaymentIntent mapping code below)
      if (piId && fetchedPaymentIntentIds.has(piId)) {
        console.log(`Invoice ${rawInv.number}: payment_intent ${piId} is in fetched list, will be handled there`);
        return;
      }

      // If there's a payment_intent NOT in our list, we need to create a payment record
      // This happens with invoice auto-charge where Stripe creates the PI internally
      if (piId && !fetchedPaymentIntentIds.has(piId)) {
        console.log(`Invoice ${rawInv.number}: payment_intent ${piId} NOT in fetched list, creating from invoice`);

        // Skip if already processed
        if (processedIds.has(piId)) return;
        processedIds.add(piId);

        // If we have an expanded charge, use it for details
        if (charge && typeof charge !== 'string') {
          invoiceBasedPayments.push({
            id: piId,
            amount: charge.amount,
            amount_refunded: charge.amount_refunded || 0,
            currency: charge.currency,
            status: charge.status === 'succeeded' ? 'succeeded' : charge.status,
            created: charge.created,
            invoice: invId,
            invoiceNumber: rawInv.number,
            payment_method_types: [charge.payment_method_details?.type || 'card'],
            refunded: charge.refunded || false,
            metadata: charge.metadata || {},
            customer: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id || null,
            description: charge.description || rawInv.description || null,
            refund_reason: null,
          });
        } else {
          // No expanded charge, create from invoice data
          invoiceBasedPayments.push({
            id: piId,
            amount: rawInv.amount_paid,
            amount_refunded: 0,
            currency: rawInv.currency,
            status: 'succeeded',
            created: rawInv.status_transitions?.paid_at || rawInv.created,
            invoice: invId,
            invoiceNumber: rawInv.number,
            payment_method_types: ['card'],
            refunded: false,
            metadata: rawInv.metadata || {},
            customer: typeof rawInv.customer === 'string' ? rawInv.customer : rawInv.customer?.id || null,
            description: rawInv.description || `Payment for invoice ${rawInv.number}`,
            refund_reason: null,
          });
        }
        return;
      }

      // No payment_intent - check for charge-only payments (older integrations)
      console.log(`Invoice ${rawInv.number}: no payment_intent, charge=${chargeId || 'NULL'}, paid_out_of_band=${rawInv.paid_out_of_band}`);

      // If there's a charge (expanded object), create a payment entry from it
      if (charge && typeof charge !== 'string') {
        // Skip if we already processed this charge
        if (processedIds.has(charge.id)) return;
        processedIds.add(charge.id);

        invoiceBasedPayments.push({
          id: charge.id,
          amount: charge.amount,
          amount_refunded: charge.amount_refunded || 0,
          currency: charge.currency,
          status: charge.status === 'succeeded' ? 'succeeded' : charge.status,
          created: charge.created,
          invoice: invId,
          invoiceNumber: rawInv.number,
          payment_method_types: [charge.payment_method_details?.type || 'card'],
          refunded: charge.refunded || false,
          metadata: charge.metadata || {},
          customer: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id || null,
          description: charge.description || rawInv.description || null,
          refund_reason: null,
        });
      } else if (!charge && !chargeId && rawInv.paid_out_of_band === true) {
        // Invoice was explicitly marked paid out-of-band (no charge/payment_intent)
        // Only create a virtual payment if paid_out_of_band is explicitly true
        invoiceBasedPayments.push({
          id: `inv_paid_${invId}`, // Virtual ID to indicate it's from an invoice
          amount: rawInv.amount_paid,
          amount_refunded: 0,
          currency: rawInv.currency,
          status: 'succeeded',
          created: rawInv.status_transitions?.paid_at || rawInv.created,
          invoice: invId,
          invoiceNumber: rawInv.number,
          payment_method_types: ['out_of_band'],
          refunded: false,
          metadata: rawInv.metadata || {},
          customer: typeof rawInv.customer === 'string' ? rawInv.customer : rawInv.customer?.id || null,
          description: rawInv.description || `Payment for invoice ${rawInv.number}`,
          refund_reason: null,
        });
      }
    });

    console.log(`Created ${invoiceBasedPayments.length} payments from invoices`);

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

    // Combine payment intent payments with invoice-based payments
    // Filter out duplicates (invoice-based payments for invoices that already have payment intents in our list)
    const existingInvoiceIds = new Set(payments.filter(p => p.invoice).map(p => p.invoice));
    const uniqueInvoicePayments = invoiceBasedPayments.filter((p: PaymentData) => !existingInvoiceIds.has(p.invoice));
    payments = [...payments, ...uniqueInvoicePayments];

    console.log(`Total payments after combining: ${payments.length}`);

    // Filter by invoiceUID if provided (check both cases for metadata key)
    if (invoiceUID) {
      const invoiceUIDInvoices = allInvoices
        .filter((inv) => inv.metadata?.invoiceUID === invoiceUID || inv.metadata?.InvoiceUID === invoiceUID)
        .map((inv) => inv.id);

      console.log(`Filtering for invoiceUID: ${invoiceUID}`);
      console.log(`Invoices with this invoiceUID: ${invoiceUIDInvoices.length}`, invoiceUIDInvoices);
      console.log(`Total payments before filter: ${payments.length}`);

      payments = payments.filter((p) => {
        // Include if payment is connected to an invoice with this InvoiceUID
        if (p.invoice && invoiceUIDInvoices.includes(p.invoice)) {
          console.log(`Payment ${p.id} matched via invoice link: ${p.invoice}`);
          return true;
        }
        // Also include if payment has InvoiceUID directly in its metadata (e.g., Pay Now payments)
        if (p.metadata?.InvoiceUID === invoiceUID || p.metadata?.invoiceUID === invoiceUID) {
          console.log(`Payment ${p.id} matched via metadata`);
          return true;
        }
        return false;
      });

      console.log(`Total payments after filter: ${payments.length}`);
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
    const { amount, currency, paymentMethodId, customerId, description, saveCard, accountId } = body;

    if (!amount || !paymentMethodId) {
      return NextResponse.json(
        { success: false, error: 'amount and paymentMethodId are required' },
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
