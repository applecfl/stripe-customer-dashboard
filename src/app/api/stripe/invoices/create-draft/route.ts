import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { mapInvoice } from '@/lib/mappers';
import { InvoiceData, ApiResponse } from '@/types';

interface SourceInvoice {
  id: string;
  metadata?: Record<string, string>;
}

interface CreateDraftRequest {
  customerId: string;
  amount: number; // in cents
  currency: string;
  description?: string;
  invoiceUID?: string;
  scheduledDate?: number; // Unix timestamp for when to finalize
  accountId: string;
  paymentMethodId?: string; // Payment method to use for this invoice
  sourceInvoice?: SourceInvoice; // Original invoice to void and copy metadata from
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<InvoiceData>>> {
  try {
    const body: CreateDraftRequest = await request.json();
    const { customerId, amount, currency, description, invoiceUID, scheduledDate, accountId, paymentMethodId, sourceInvoice } = body;

    if (!customerId || !amount || !currency) {
      return NextResponse.json(
        { success: false, error: 'customerId, amount, and currency are required' },
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

    // If there's a source invoice (e.g., failed payment), void it first
    if (sourceInvoice?.id) {
      try {
        await stripe.invoices.voidInvoice(sourceInvoice.id);
      } catch (voidError) {
        console.error('Error voiding source invoice:', voidError);
        // Continue even if void fails - the invoice might already be voided or in an invalid state
      }
    }

    // Build metadata - copy from source invoice if available, then overlay our values
    const metadata: Record<string, string> = {
      ...(sourceInvoice?.metadata || {}), // Copy metadata from source invoice
      ...(invoiceUID && { InvoiceUID: invoiceUID }), // Override with new InvoiceUID if provided
      ...(scheduledDate && { scheduledFinalizeAt: scheduledDate.toString() }),
      ...(sourceInvoice?.id && { sourceInvoiceId: sourceInvoice.id, voidReason: 'Rescheduled as future payment' }),
    };

    // Create a draft invoice with automatically_finalizes_at for exact scheduling
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'charge_automatically',
      auto_advance: scheduledDate ? true : false,
      ...(paymentMethodId && { default_payment_method: paymentMethodId }),
      ...(scheduledDate && { automatically_finalizes_at: scheduledDate }),
      metadata,
    });

    // Add an invoice item for the amount
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount,
      currency,
      description: description || 'Payment',
    });

    // Retrieve the full invoice with line items
    const fullInvoice = await stripe.invoices.retrieve(invoice.id, {
      expand: ['lines'],
    });

    return NextResponse.json({
      success: true,
      data: mapInvoice(fullInvoice),
    });
  } catch (error) {
    console.error('Error creating draft invoice:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create draft invoice' },
      { status: 500 }
    );
  }
}
