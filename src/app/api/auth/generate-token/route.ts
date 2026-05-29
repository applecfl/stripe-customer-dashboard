import { NextRequest, NextResponse } from 'next/server';
import { generateToken, generatePaymentLinkToken, isClientChainAllowed, getClientIP, ExtendedCustomerInfo, OtherPayment } from '@/lib/auth';

interface GenerateTokenRequest {
  CustomerID: string;
  InvoiceUID: string;
  AccountID: string;
  // Extended customer info
  FatherName?: string;
  FatherEmail?: string;
  FatherCell?: string | number;
  MotherName?: string;
  MotherEmail?: string;
  MotherCell?: string | number;
  // Pre-formatted parent names for emails
  ParentsName?: string;
  // Email sender info
  Sender?: {
    Name: string;
    Email: string;
  };
  // Payment summary info
  Total?: number;
  Description?: string;
  // Token kind: "payment_link" mints a single-use 7-day customer-facing pay link.
  // Requires Amount (cents). Omit/other => normal 30-min dashboard token.
  Kind?: 'dashboard' | 'payment_link';
  // For payment_link: exact amount (cents) the customer may pay.
  Amount?: number;
  // Other payments (Zelle, Cash, etc.)
  OtherPayments?: Array<{
    PaymentDate: string;
    Amount: number;
    PaymentType: string;
    Description: string;
  }>;
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
    // Get client IP (for logging)
    const clientIP = getClientIP(request);

    // Validate the full forwarding chain is whitelisted (resistant to XFF spoofing).
    if (!isClientChainAllowed(request)) {
      console.warn(`Token generation rejected - IP not allowed: ${clientIP} (xff: ${request.headers.get('x-forwarded-for')})`);
      return NextResponse.json(
        { success: false, error: 'Access denied' },
        { status: 403 }
      );
    }

    // Parse request body
    const body: GenerateTokenRequest = await request.json();
    const {
      CustomerID: customerId,
      InvoiceUID: invoiceUID,
      AccountID: accountId,
      FatherName,
      FatherEmail,
      FatherCell,
      MotherName,
      MotherEmail,
      MotherCell,
      ParentsName,
      Sender,
      Total,
      Description,
      OtherPayments,
      Kind,
      Amount,
    } = body;

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

    // Build extended info if any data is provided
    const extendedInfo: ExtendedCustomerInfo | undefined =
      (FatherName || FatherEmail || FatherCell || MotherName || MotherEmail || MotherCell || ParentsName || Sender || Total || Description)
        ? {
            fatherName: FatherName,
            fatherEmail: FatherEmail,
            fatherCell: FatherCell ? String(FatherCell) : undefined,
            motherName: MotherName,
            motherEmail: MotherEmail,
            motherCell: MotherCell ? String(MotherCell) : undefined,
            parentsName: ParentsName,
            senderName: Sender?.Name,
            senderEmail: Sender?.Email,
            totalAmount: Total,
            paymentName: Description,
          }
        : undefined;

    // Transform OtherPayments to lowercase keys
    const otherPayments: OtherPayment[] | undefined = OtherPayments?.map(p => ({
      paymentDate: p.PaymentDate,
      amount: p.Amount,
      paymentType: p.PaymentType,
      description: p.Description,
    }));

    // Generate token. payment_link => single-use 7-day customer pay link with a
    // bound amount; otherwise the normal 30-min dashboard token.
    let token: string;
    let expiresAt: number;

    if (Kind === 'payment_link') {
      const amountCents = typeof Amount === 'number' ? Math.round(Amount) : NaN;
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        return NextResponse.json(
          { success: false, error: 'Amount (positive cents) is required for payment_link tokens' },
          { status: 400 }
        );
      }
      ({ token, expiresAt } = generatePaymentLinkToken(customerId, invoiceUID, accountId, amountCents, extendedInfo));
      console.log(`Payment link token generated for customer ${customerId} amount ${amountCents} from IP ${clientIP}`);
    } else {
      ({ token, expiresAt } = generateToken(customerId, invoiceUID, accountId, extendedInfo, otherPayments));
      console.log(`Token generated for customer ${customerId} from IP ${clientIP}`);
    }

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
