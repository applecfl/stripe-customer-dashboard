import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';

export interface PaymentAttempt {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  failure_code: string | null;
  failure_message: string | null;
  payment_method_details: {
    brand: string | null;
    last4: string | null;
    exp_month: number | null;
    exp_year: number | null;
  } | null;
  outcome: {
    network_status: string | null;
    reason: string | null;
    risk_level: string | null;
    seller_message: string | null;
    type: string | null;
  } | null;
}

// Get all payment attempts (charges) for an invoice
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
): Promise<NextResponse<ApiResponse<PaymentAttempt[]>>> {
  try {
    const { invoiceId } = await params;
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: 'accountId is required' },
        { status: 400 }
      );
    }

    const stripe = getStripeForAccount(accountId);

    // Get the invoice with expanded charge data
    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['charge', 'payment_intent', 'payment_intent.latest_charge', 'default_payment_method'],
    });

    const invoiceCharges: Stripe.Charge[] = [];
    const seenChargeIds = new Set<string>();

    // Helper to add charge if not already added
    const addCharge = (charge: Stripe.Charge) => {
      if (!seenChargeIds.has(charge.id)) {
        seenChargeIds.add(charge.id);
        invoiceCharges.push(charge);
      }
    };

    // Method 1: Get charge directly from invoice if it exists
    if (invoice.charge) {
      const charge = typeof invoice.charge === 'string'
        ? await stripe.charges.retrieve(invoice.charge)
        : invoice.charge;
      addCharge(charge);
    }

    // Method 2: Get charges from payment intent
    if (invoice.payment_intent) {
      const piId = typeof invoice.payment_intent === 'string'
        ? invoice.payment_intent
        : invoice.payment_intent.id;

      // List all charges for this payment intent (includes failed attempts)
      const piCharges = await stripe.charges.list({
        payment_intent: piId,
        limit: 100,
      });

      for (const charge of piCharges.data) {
        addCharge(charge);
      }
    }

    // Method 3: Get charges for the customer that reference this invoice
    const customerId = typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id;

    if (customerId) {
      const customerCharges = await stripe.charges.list({
        customer: customerId,
        limit: 100,
      });

      for (const charge of customerCharges.data) {
        // Check if charge is related to this invoice (directly or via metadata)
        if (charge.invoice === invoiceId) {
          addCharge(charge);
        } else if (charge.metadata?.invoiceId === invoiceId) {
          addCharge(charge);
        }
      }

      // Method 3b: Get payment intents for the customer that reference this invoice in metadata
      // This catches manual payment attempts made via PayNow or Pay Invoice
      try {
        const paymentIntents = await stripe.paymentIntents.list({
          customer: customerId,
          limit: 100,
        });

        for (const pi of paymentIntents.data) {
          // Check if this payment intent is for this invoice (via metadata or selectedInvoiceIds)
          const selectedIds = pi.metadata?.selectedInvoiceIds?.split(',') || [];
          const isForThisInvoice = pi.metadata?.invoiceId === invoiceId ||
            selectedIds.includes(invoiceId);

          if (isForThisInvoice) {
            // Get charges for this payment intent
            const piCharges = await stripe.charges.list({
              payment_intent: pi.id,
              limit: 10,
            });
            for (const charge of piCharges.data) {
              addCharge(charge);
            }
          }
        }
      } catch (piError) {
        console.log('Could not fetch payment intents:', piError);
      }
    }

    // Method 4: Get events related to invoice payment failures
    // This catches payment attempts that may not have created charges
    let paymentFailedEvents: Stripe.Event[] = [];
    let paymentSucceededEvents: Stripe.Event[] = [];

    try {
      const events = await stripe.events.list({
        type: 'invoice.payment_failed',
        limit: 100,
      });

      // Filter events for this invoice
      paymentFailedEvents = events.data.filter(event => {
        const eventInvoice = event.data.object as Stripe.Invoice;
        return eventInvoice.id === invoiceId;
      });

      // Also get payment_succeeded events
      const successEvents = await stripe.events.list({
        type: 'invoice.payment_succeeded',
        limit: 100,
      });

      paymentSucceededEvents = successEvents.data.filter(event => {
        const eventInvoice = event.data.object as Stripe.Invoice;
        return eventInvoice.id === invoiceId;
      });
    } catch (eventError) {
      // Events API may fail for older invoices (>30 days), continue without events
      console.log('Events not available:', eventError);
    }

    // Sort charges by created date (newest first)
    invoiceCharges.sort((a, b) => b.created - a.created);

    // Transform charges to our response format
    const attempts: PaymentAttempt[] = invoiceCharges.map(charge => ({
      id: charge.id,
      amount: charge.amount,
      currency: charge.currency,
      status: charge.status,
      created: charge.created,
      failure_code: charge.failure_code,
      failure_message: charge.failure_message,
      payment_method_details: charge.payment_method_details?.card ? {
        brand: charge.payment_method_details.card.brand,
        last4: charge.payment_method_details.card.last4,
        exp_month: charge.payment_method_details.card.exp_month,
        exp_year: charge.payment_method_details.card.exp_year,
      } : null,
      outcome: charge.outcome ? {
        network_status: charge.outcome.network_status,
        reason: charge.outcome.reason,
        risk_level: charge.outcome.risk_level,
        seller_message: charge.outcome.seller_message,
        type: charge.outcome.type,
      } : null,
    }));

    // If we found events but no charges, create attempt records from events
    if (attempts.length === 0 && (paymentFailedEvents.length > 0 || paymentSucceededEvents.length > 0)) {
      // Process failed events
      for (const event of paymentFailedEvents) {
        const eventInvoice = event.data.object as Stripe.Invoice;
        const lastError = eventInvoice.last_finalization_error as Stripe.Invoice.LastFinalizationError | null;

        attempts.push({
          id: event.id,
          amount: eventInvoice.amount_due,
          currency: eventInvoice.currency,
          status: 'failed',
          created: event.created,
          failure_code: lastError?.code || null,
          failure_message: lastError?.message || 'Payment failed',
          payment_method_details: null,
          outcome: null,
        });
      }

      // Process succeeded events
      for (const event of paymentSucceededEvents) {
        const eventInvoice = event.data.object as Stripe.Invoice;

        attempts.push({
          id: event.id,
          amount: eventInvoice.amount_paid,
          currency: eventInvoice.currency,
          status: 'succeeded',
          created: event.created,
          failure_code: null,
          failure_message: null,
          payment_method_details: null,
          outcome: null,
        });
      }

      // Sort by created date
      attempts.sort((a, b) => b.created - a.created);
    }

    // If still no attempts but invoice shows attempt_count > 0, create placeholder records
    if (attempts.length === 0 && invoice.attempt_count > 0) {
      const lastError = invoice.last_finalization_error as Stripe.Invoice.LastFinalizationError | null;

      // Get payment method info from the default payment method if available (already expanded)
      let pmDetails: PaymentAttempt['payment_method_details'] = null;
      if (invoice.default_payment_method && typeof invoice.default_payment_method !== 'string') {
        const pm = invoice.default_payment_method as Stripe.PaymentMethod;
        if (pm.card) {
          pmDetails = {
            brand: pm.card.brand,
            last4: pm.card.last4,
            exp_month: pm.card.exp_month,
            exp_year: pm.card.exp_year,
          };
        }
      }

      // Create attempt records based on attempt_count
      // We only have data for the last attempt, but show the count
      const attemptTime = invoice.status_transitions?.finalized_at ||
                          invoice.status_transitions?.marked_uncollectible_at ||
                          invoice.created;

      attempts.push({
        id: `${invoiceId}-attempt-${invoice.attempt_count}`,
        amount: invoice.amount_due,
        currency: invoice.currency,
        status: 'failed',
        created: attemptTime,
        failure_code: lastError?.code || null,
        failure_message: lastError?.message || `Payment failed (${invoice.attempt_count} attempt${invoice.attempt_count > 1 ? 's' : ''} made)`,
        payment_method_details: pmDetails,
        outcome: null,
      });
    }

    return NextResponse.json({
      success: true,
      data: attempts,
    });
  } catch (error) {
    console.error('Error fetching payment attempts:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch payment attempts' },
      { status: 500 }
    );
  }
}
