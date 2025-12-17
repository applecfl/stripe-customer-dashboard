import { NextRequest, NextResponse } from 'next/server';
import { getStripeForAccount } from '@/lib/stripe';
import { ApiResponse } from '@/types';
import { isAllowedIP, getClientIP } from '@/lib/auth';

interface UpdateUIDItem {
  PaymentID: string;
  InvoiceUID: string;
}

interface UpdateResult {
  paymentId: string;
  success: boolean;
  error?: string;
}

// Configuration for rate limiting
const BATCH_SIZE = 10; // Process 10 items at a time
const DELAY_BETWEEN_BATCHES_MS = 500; // 500ms delay between batches

// Helper to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Bulk update payment intents with InvoiceUID in metadata
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<UpdateResult[]>>> {
  try {
    // Validate IP is in whitelist
    const clientIP = getClientIP(request);
    if (!isAllowedIP(clientIP)) {
      console.warn(`Update UIDs rejected - IP not allowed: ${clientIP}`);
      return NextResponse.json(
        { success: false, error: 'Access denied' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { Payments, AccountID } = body as { Payments: UpdateUIDItem[]; AccountID: string };

    if (!Payments || !Array.isArray(Payments) || Payments.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Payments array is required and must not be empty' },
        { status: 400 }
      );
    }

    if (!AccountID) {
      return NextResponse.json(
        { success: false, error: 'AccountID is required' },
        { status: 400 }
      );
    }

    const stripe = getStripeForAccount(AccountID);

    // Process updates in batches with delays to avoid rate limits
    const results: UpdateResult[] = [];

    // Split payments into batches
    for (let i = 0; i < Payments.length; i += BATCH_SIZE) {
      const batch = Payments.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (item) => {
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

      results.push(...batchResults);

      // Add delay between batches (except after the last batch)
      if (i + BATCH_SIZE < Payments.length) {
        await delay(DELAY_BETWEEN_BATCHES_MS);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(`Bulk update complete: ${successCount} succeeded, ${failCount} failed`);

    return NextResponse.json({
      success: failCount === 0,
      data: results,
      error: failCount > 0 ? `${failCount} of ${Payments.length} updates failed` : undefined,
    });
  } catch (error) {
    console.error('Error in bulk update UIDs:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update payment intents' },
      { status: 500 }
    );
  }
}
