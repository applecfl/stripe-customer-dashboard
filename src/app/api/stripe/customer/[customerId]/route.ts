import { NextRequest, NextResponse } from 'next/server';
import stripe from '@/lib/stripe';
import { CustomerData, CreditBalanceTransaction, ApiResponse } from '@/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
): Promise<NextResponse<ApiResponse<{ customer: CustomerData; creditTransactions: CreditBalanceTransaction[] }>>> {
  try {
    const { customerId } = await params;

    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['default_source'],
    });

    if (customer.deleted) {
      return NextResponse.json(
        { success: false, error: 'Customer has been deleted' },
        { status: 404 }
      );
    }

    // Get customer's balance transactions
    const balanceTransactions = await stripe.customers.listBalanceTransactions(customerId, {
      limit: 100,
    });

    // Get default payment method if exists
    let defaultPaymentMethod = null;
    if (customer.invoice_settings?.default_payment_method) {
      const pmId = typeof customer.invoice_settings.default_payment_method === 'string'
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings.default_payment_method.id;

      const pm = await stripe.paymentMethods.retrieve(pmId);
      defaultPaymentMethod = {
        id: pm.id,
        type: pm.type,
        card: pm.card ? {
          brand: pm.card.brand,
          last4: pm.card.last4,
          exp_month: pm.card.exp_month,
          exp_year: pm.card.exp_year,
        } : undefined,
        created: pm.created,
        isDefault: true,
      };
    }

    const customerData: CustomerData = {
      id: customer.id,
      name: customer.name ?? null,
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      balance: customer.balance ?? 0,
      currency: customer.currency || 'usd',
      created: customer.created,
      metadata: customer.metadata || {},
      defaultPaymentMethod,
    };

    const creditTransactions: CreditBalanceTransaction[] = balanceTransactions.data.map((bt) => ({
      id: bt.id,
      amount: bt.amount,
      currency: bt.currency,
      created: bt.created,
      description: bt.description,
      type: bt.type,
      ending_balance: bt.ending_balance,
    }));

    return NextResponse.json({
      success: true,
      data: { customer: customerData, creditTransactions },
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch customer' },
      { status: 500 }
    );
  }
}

// Add credit to customer balance
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
): Promise<NextResponse<ApiResponse<CreditBalanceTransaction>>> {
  try {
    const { customerId } = await params;
    const body = await request.json();
    const { amount, description } = body;

    if (!amount || typeof amount !== 'number') {
      return NextResponse.json(
        { success: false, error: 'Amount is required and must be a number' },
        { status: 400 }
      );
    }

    // Negative amount = credit (reduces what customer owes)
    const balanceTransaction = await stripe.customers.createBalanceTransaction(customerId, {
      amount: -Math.abs(amount), // Ensure it's negative for credit
      currency: 'usd',
      description: description || 'Manual credit adjustment',
    });

    return NextResponse.json({
      success: true,
      data: {
        id: balanceTransaction.id,
        amount: balanceTransaction.amount,
        currency: balanceTransaction.currency,
        created: balanceTransaction.created,
        description: balanceTransaction.description,
        type: balanceTransaction.type,
        ending_balance: balanceTransaction.ending_balance,
      },
    });
  } catch (error) {
    console.error('Error adding credit:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to add credit' },
      { status: 500 }
    );
  }
}

// Pause all invoices for customer
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
): Promise<NextResponse<ApiResponse<{ pausedCount: number }>>> {
  try {
    const { customerId } = await params;
    const body = await request.json();
    const { pause, invoiceUID } = body;

    // Get all open invoices for this customer with the invoiceUID
    const invoices = await stripe.invoices.list({
      customer: customerId,
      status: 'open',
      limit: 100,
    });

    // Filter by invoiceUID if provided
    const filteredInvoices = invoiceUID
      ? invoices.data.filter((inv) => inv.metadata?.invoiceUID === invoiceUID)
      : invoices.data;

    let pausedCount = 0;

    for (const invoice of filteredInvoices) {
      if (pause) {
        // Store original due date and mark as paused
        await stripe.invoices.update(invoice.id, {
          metadata: {
            ...invoice.metadata,
            isPaused: 'true',
            originalDueDate: invoice.due_date?.toString() || '',
          },
          collection_method: 'send_invoice', // Disable auto-collection
        });
      } else {
        // Restore auto-collection
        await stripe.invoices.update(invoice.id, {
          metadata: {
            ...invoice.metadata,
            isPaused: 'false',
          },
          collection_method: 'charge_automatically',
        });
      }
      pausedCount++;
    }

    return NextResponse.json({
      success: true,
      data: { pausedCount },
    });
  } catch (error) {
    console.error('Error pausing invoices:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to pause invoices' },
      { status: 500 }
    );
  }
}
