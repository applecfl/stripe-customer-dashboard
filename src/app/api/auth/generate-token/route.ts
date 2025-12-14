import { NextRequest, NextResponse } from 'next/server';
import { generateToken, isAllowedIP, getClientIP } from '@/lib/auth';

interface GenerateTokenRequest {
  CustomerID: string;
  InvoiceUID: string;
  AccountID: string;
}

interface GenerateTokenResponse {
  success: boolean;
  token?: string;
  expiresAt?: number;
  error?: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<GenerateTokenResponse>> {
  try {
    // Get client IP
    const clientIP = getClientIP(request);

    // Validate IP is in whitelist
    if (!isAllowedIP(clientIP)) {
      console.warn(`Token generation rejected - IP not allowed: ${clientIP}`);
      return NextResponse.json(
        { success: false, error: 'Access denied' },
        { status: 403 }
      );
    }

    // Parse request body
    const body: GenerateTokenRequest = await request.json();
    const { CustomerID: customerId, InvoiceUID: invoiceUID, AccountID: accountId } = body;

    // Validate required fields
    if (!customerId || typeof customerId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'CustomerID is required' },
        { status: 400 }
      );
    }

    if (!invoiceUID || typeof invoiceUID !== 'string') {
      return NextResponse.json(
        { success: false, error: 'InvoiceUID is required' },
        { status: 400 }
      );
    }

    if (!accountId || typeof accountId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'AccountID is required' },
        { status: 400 }
      );
    }

    // Validate customerId format (should start with cus_)
    if (!customerId.startsWith('cus_')) {
      return NextResponse.json(
        { success: false, error: 'Invalid CustomerID format' },
        { status: 400 }
      );
    }

    // Generate token
    const { token, expiresAt } = generateToken(customerId, invoiceUID, accountId);

    console.log(`Token generated for customer ${customerId} from IP ${clientIP}`);

    return NextResponse.json({
      success: true,
      token,
      expiresAt,
    });
  } catch (error) {
    console.error('Error generating token:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate token' },
      { status: 500 }
    );
  }
}
