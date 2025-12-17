import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { mapInvoice } from '@/lib/mappers';
import { InvoiceData, ApiResponse } from '@/types';

interface CreateDraftRequest {
  customerId: string;
  amount: number; // in cents
  currency: string;
  description?: string;
  invoiceUID?: string;
  scheduledDate?: number; // Unix timestamp for when to finalize
  accountId: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<InvoiceData>>> {
  try {
    const body: CreateDraftRequest = await request.json();
    const { customerId, amount, currency, description, invoiceUID, scheduledDate, accountId } = body;

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

    // Create a draft invoice
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'charge_automatically',
      auto_advance: scheduledDate ? true : false,
      metadata: {
        ...(invoiceUID && { invoiceUID }),
        ...(scheduledDate && { scheduledFinalizeAt: scheduledDate.toString() }),
      },
    });

    // Add an invoice item for the amount
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount,
      currency,
      description: description || 'Payment',
    });

    // If scheduled date is provided, set the due_date
    let updatedInvoice = invoice;
    if (scheduledDate) {
      const now = Math.floor(Date.now() / 1000);
      const isFutureDate = scheduledDate > now;

      updatedInvoice = await stripe.invoices.update(invoice.id, {
        auto_advance: true,
        ...(isFutureDate && { due_date: scheduledDate }),
        metadata: {
          ...invoice.metadata,
          scheduledFinalizeAt: scheduledDate.toString(),
        },
      });
    }

    // Retrieve the full invoice with line items
    const fullInvoice = await stripe.invoices.retrieve(updatedInvoice.id, {
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
