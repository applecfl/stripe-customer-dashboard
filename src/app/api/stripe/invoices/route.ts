import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripeForAccount } from '@/lib/stripe';
import { mapInvoice } from '@/lib/mappers';
import { InvoiceData, ApiResponse } from '@/types';

// Force dynamic rendering - never cache this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<InvoiceData[]>>> {
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

    // Fetch ALL invoices for the customer (handle pagination)
    const allInvoices: Stripe.Invoice[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: Stripe.InvoiceListParams = {
        customer: customerId,
        limit: 100,
        expand: ['data.lines'],
      };
      if (startingAfter) {
        params.starting_after = startingAfter;
      }

      const invoices = await stripe.invoices.list(params);
      allInvoices.push(...invoices.data);
      hasMore = invoices.has_more;
      if (invoices.data.length > 0) {
        startingAfter = invoices.data[invoices.data.length - 1].id;
      }
    }

    // Filter by invoiceUID if provided (check both cases for metadata key)
    let filteredInvoices = allInvoices;
    if (invoiceUID) {
      filteredInvoices = allInvoices.filter(
        (inv) => inv.metadata?.invoiceUID === invoiceUID || inv.metadata?.InvoiceUID === invoiceUID
      );
    }

    // Debug: Log draft invoice amounts from Stripe API
    const draftInvoices = filteredInvoices.filter(inv => inv.status === 'draft');
    if (draftInvoices.length > 0) {
      console.log(`[INVOICES] Found ${draftInvoices.length} draft invoices from Stripe API:`);
      draftInvoices.forEach(inv => {
        console.log(`  Draft ${inv.id}:`, {
          amount_due: inv.amount_due,
          subtotal: inv.subtotal,
          total: inv.total,
          lines_count: inv.lines?.data?.length || 0,
          lines_total: inv.lines?.data?.reduce((sum, l) => sum + l.amount, 0) || 0,
        });
      });
    }

    const invoiceData: InvoiceData[] = filteredInvoices.map(mapInvoice);

    // Return response with no-cache headers to ensure fresh data
    return NextResponse.json(
      {
        success: true,
        data: invoiceData,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch invoices' },
      { status: 500 }
    );
  }
}
