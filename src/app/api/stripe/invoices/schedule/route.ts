import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';

interface ScheduleResult {
  invoiceId: string;
  scheduledDate: number;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<ScheduleResult>>> {
  try {
    const body = await request.json();
    const { invoiceId, scheduledDate, accountId } = body;

    if (!invoiceId || !scheduledDate) {
      return NextResponse.json(
        { success: false, error: 'invoiceId and scheduledDate are required' },
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

    // Get the current invoice
    const invoice = await stripe.invoices.retrieve(invoiceId);

    if (invoice.status !== 'draft') {
      return NextResponse.json(
        { success: false, error: 'Can only schedule draft invoices' },
        { status: 400 }
      );
    }

    console.log(`Updating invoice ${invoiceId} with automatically_finalizes_at=${scheduledDate}`);

    // Update with automatically_finalizes_at for exact scheduling at 12:00 noon
    const updatedInvoice = await stripe.invoices.update(invoiceId, {
      auto_advance: true,
      automatically_finalizes_at: scheduledDate,
      metadata: {
        ...invoice.metadata,
        scheduledFinalizeAt: scheduledDate.toString(),
      },
    });

    console.log(`Updated invoice:`, {
      metadata: updatedInvoice.metadata,
      auto_advance: updatedInvoice.auto_advance,
      automatically_finalizes_at: updatedInvoice.automatically_finalizes_at,
    });

    return NextResponse.json({
      success: true,
      data: { invoiceId, scheduledDate },
    });
  } catch (error) {
    console.error('Error scheduling invoice:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to schedule invoice' },
      { status: 500 }
    );
  }
}
