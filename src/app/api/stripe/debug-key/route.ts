import { NextRequest, NextResponse } from 'next/server';

// Debug endpoint to show which secret key is being used for an account
// Returns only the prefix (first 20 chars) for security
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('accountId');

    if (!accountId) {
      return NextResponse.json({ success: false, error: 'accountId is required' }, { status: 400 });
    }

    // Get the STRIPE_LIST and find the key for this account
    const stripeListStr = process.env.STRIPE_LIST;
    if (!stripeListStr) {
      return NextResponse.json({ success: false, error: 'STRIPE_LIST not configured' }, { status: 500 });
    }

    const stripeList = JSON.parse(stripeListStr);
    const accountConfig = stripeList[accountId];

    if (!accountConfig) {
      return NextResponse.json({ success: false, error: `Account ${accountId} not found in STRIPE_LIST` }, { status: 404 });
    }

    if (!accountConfig.key) {
      return NextResponse.json({ success: false, error: `No key configured for account ${accountId}` }, { status: 404 });
    }

    // Return just the first 20 characters of the key for debugging
    const keyPrefix = accountConfig.key.substring(0, 20) + '...';
    const isLive = accountConfig.key.startsWith('sk_live') || accountConfig.key.startsWith('rk_live');

    return NextResponse.json({
      success: true,
      keyPrefix,
      isLive,
      accountName: accountConfig.name,
    });
  } catch (error) {
    console.error('Error in debug-key:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to get key info' },
      { status: 500 }
    );
  }
}
