import { NextRequest, NextResponse } from 'next/server';
import stripe from '@/lib/stripe';
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
    const { invoiceId, scheduledDate } = body;

    if (!invoiceId || !scheduledDate) {
      return NextResponse.json(
        { success: false, error: 'invoiceId and scheduledDate are required' },
        { status: 400 }
      );
    }

    // Get the current invoice
    const invoice = await stripe.invoices.retrieve(invoiceId);

    if (invoice.status !== 'draft') {
      return NextResponse.json(
        { success: false, error: 'Can only schedule draft invoices' },
        { status: 400 }
      );
    }

    // Check if date is in the future (Stripe's due_date only accepts future dates)
    const now = Math.floor(Date.now() / 1000);
    const isFutureDate = scheduledDate > now;

    console.log(`Updating invoice ${invoiceId} with scheduledFinalizeAt=${scheduledDate}, isFutureDate=${isFutureDate}`);

    // Step 1: First, disable auto_advance to clear any existing schedule
    if (invoice.auto_advance) {
      console.log('Disabling auto_advance first to clear existing schedule');
      await stripe.invoices.update(invoiceId, { auto_advance: false });
    }

    // Step 2: Re-enable with new settings
    const updatePayload: {
      auto_advance: boolean;
      due_date?: number;
      metadata: Record<string, string>;
    } = {
      auto_advance: true,
      metadata: {
        ...invoice.metadata,
        scheduledFinalizeAt: scheduledDate.toString(),
      },
    };

    // Only set due_date if it's in the future
    if (isFutureDate) {
      updatePayload.due_date = scheduledDate;
    }

    console.log('Update payload:', JSON.stringify(updatePayload, null, 2));

    const updatedInvoice = await stripe.invoices.update(invoiceId, updatePayload);

    console.log(`Updated invoice:`, {
      metadata: updatedInvoice.metadata,
      due_date: updatedInvoice.due_date,
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
