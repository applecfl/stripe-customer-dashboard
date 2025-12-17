import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';

interface UpdateUIDItem {
  PaymentID: string;
  InvoiceUID: string;
}

interface UpdateResult {
  paymentId: string;
  success: boolean;
  error?: string;
}

// Bulk update payment intents with InvoiceUID in metadata
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<UpdateResult[]>>> {
  try {
    const body = await request.json();
    const { items, accountId } = body as { items: UpdateUIDItem[]; accountId: string };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'items array is required and must not be empty' },
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

    // Process each update
    const results: UpdateResult[] = await Promise.all(
      items.map(async (item) => {
        try {
          if (!item.PaymentID || !item.InvoiceUID) {
            return {
              paymentId: item.PaymentID || 'unknown',
              success: false,
              error: 'PaymentID and InvoiceUID are required',
            };
          }

          // Update the payment intent's metadata with the InvoiceUID
          await stripe.paymentIntents.update(item.PaymentID, {
            metadata: {
              InvoiceUID: item.InvoiceUID,
            },
          });

          console.log(`Updated payment intent ${item.PaymentID} with InvoiceUID: ${item.InvoiceUID}`);

          return {
            paymentId: item.PaymentID,
            success: true,
          };
        } catch (err) {
          console.error(`Error updating payment intent ${item.PaymentID}:`, err);
          return {
            paymentId: item.PaymentID,
            success: false,
            error: err instanceof Error ? err.message : 'Failed to update payment intent',
          };
        }
      })
    );

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(`Bulk update complete: ${successCount} succeeded, ${failCount} failed`);

    return NextResponse.json({
      success: failCount === 0,
      data: results,
      error: failCount > 0 ? `${failCount} of ${items.length} updates failed` : undefined,
    });
  } catch (error) {
    console.error('Error in bulk update UIDs:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update payment intents' },
      { status: 500 }
    );
  }
}
