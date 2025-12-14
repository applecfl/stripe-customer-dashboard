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

    // Generate a new token with the same customer/invoice data
    const { token, expiresAt } = generateToken(payload.customerId, payload.invoiceUID);

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
