import { NextRequest, NextResponse } from 'next/server';
import { generateToken, verifyToken } from '@/lib/auth';

interface RefreshTokenResponse {
  success: boolean;
  token?: string;
  expiresAt?: number;
  error?: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<RefreshTokenResponse>> {
  try {
    const body = await request.json();
    const { token: currentToken } = body;

    if (!currentToken || typeof currentToken !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Current token is required' },
        { status: 400 }
      );
    }

    // Verify the current token is still valid
    const payload = verifyToken(currentToken);

    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // SECURITY: only dashboard tokens may be refreshed. A payment_link token must
    // never be exchanged for a dashboard token — that would let a customer's pay
    // link escalate into full admin access. Pay links are single-use & long-lived
    // and are never refreshed (only the dashboard calls this endpoint).
    if (payload.kind === 'payment_link') {
      return NextResponse.json(
        { success: false, error: 'This token cannot be refreshed' },
        { status: 403 }
      );
    }

    // Generate a new token with the same customer/invoice/account data
    const { token, expiresAt } = generateToken(payload.customerId, payload.invoiceUID, payload.accountId);

    console.log(`Token refreshed for customer ${payload.customerId}`);

    return NextResponse.json({
      success: true,
      token,
      expiresAt,
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to refresh token' },
      { status: 500 }
    );
  }
}
