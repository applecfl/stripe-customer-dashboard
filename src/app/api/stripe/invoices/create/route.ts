import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@/types';

const EXTERNAL_API_URL = process.env.EXTERNAL_API_URL || 'https://webhook.lec.li';

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse>> {
  try {
    const body = await request.json();

    const {
      customerId,
      amount,
      description,
      paymentMethodId,
      currency = 'usd',
      frequency,
      cycles = 1,
      startDate,
      dates: customDates,
      firstPaymentNumber = 1,
      metadata,
      accountId,
    } = body;

    // Build invoice object in the format expected by the external API
    const invoiceConfig = {
      CustomerID: customerId,
      Amount: amount,
      Description: description || '',
      Currency: currency,
      Frequency: frequency,
      Cycles: customDates ? customDates.length : cycles,
      StartDate: startDate,
      Dates: customDates,
      FirstPaymentNumber: firstPaymentNumber,
      Metadata: metadata || {},
      PaymentMethodId: paymentMethodId,
    };

    const requestBody = {
      AccountID: accountId,
      Invoices: [invoiceConfig],
    };

    console.log('Creating invoices - Request body:', JSON.stringify(requestBody, null, 2));

    // Forward request to external API
    const response = await fetch(`${EXTERNAL_API_URL}/stripe/createFutureInvoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const result = await response.json();

    console.log('External API response:', response.status, JSON.stringify(result, null, 2));

    if (!response.ok) {
      const errorMessage = result.error || result.message || result.Message || JSON.stringify(result);
      console.error('External API error:', errorMessage);
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: response.status }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error creating invoices:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to create invoices' },
      { status: 500 }
    );
  }
}
