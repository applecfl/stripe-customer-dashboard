import { NextRequest, NextResponse } from 'next/server';
import { getStripeAccountInfo } from '@/lib/stripe';

interface AccountInfoResponse {
  success: boolean;
  data?: {
    name: string;
    id: string;
    logo?: string;
    publishableKey: string;
  };
  error?: string;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<AccountInfoResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: 'accountId is required' },
        { status: 400 }
      );
    }

    const accountInfo = getStripeAccountInfo(accountId);

    if (!accountInfo) {
      return NextResponse.json(
        { success: false, error: 'Account not found' },
        { status: 404 }
      );
    }

    // No fallbacks - publishable key must be in STRIPE_LIST
    if (!accountInfo.publishableKey) {
      return NextResponse.json(
        { success: false, error: `No publishable key configured for account ${accountId}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        name: accountInfo.name,
        id: accountInfo.id,
        logo: accountInfo.logo,
        publishableKey: accountInfo.publishableKey,
      },
    });
  } catch (error) {
    console.error('Error fetching account info:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch account info' },
      { status: 500 }
    );
  }
}
