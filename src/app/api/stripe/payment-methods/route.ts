import { NextRequest, NextResponse } from 'next/server';
import stripe from '@/lib/stripe';
import { PaymentMethodData, ApiResponse } from '@/types';

// Get payment methods for customer
export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PaymentMethodData[]>>> {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');

    if (!customerId) {
      return NextResponse.json(
        { success: false, error: 'customerId is required' },
        { status: 400 }
      );
    }

    // Get customer to check default payment method
    const customer = await stripe.customers.retrieve(customerId);

    if (customer.deleted) {
      return NextResponse.json(
        { success: false, error: 'Customer has been deleted' },
        { status: 404 }
      );
    }

    const defaultPmId = typeof customer.invoice_settings?.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings?.default_payment_method?.id;

    // Get all payment methods
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
      limit: 100,
    });

    const paymentMethodData: PaymentMethodData[] = paymentMethods.data.map((pm) => ({
      id: pm.id,
      type: pm.type,
      card: pm.card ? {
        brand: pm.card.brand,
        last4: pm.card.last4,
        exp_month: pm.card.exp_month,
        exp_year: pm.card.exp_year,
      } : undefined,
      created: pm.created,
      isDefault: pm.id === defaultPmId,
    }));

    return NextResponse.json({
      success: true,
      data: paymentMethodData,
    });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch payment methods' },
      { status: 500 }
    );
  }
}

// Add new payment method to customer
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<PaymentMethodData>>> {
  try {
    const body = await request.json();
    const { customerId, paymentMethodId, setAsDefault } = body;

    if (!customerId || !paymentMethodId) {
      return NextResponse.json(
        { success: false, error: 'customerId and paymentMethodId are required' },
        { status: 400 }
      );
    }

    // Attach payment method to customer
    const paymentMethod = await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Set as default if requested
    if (setAsDefault) {
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: paymentMethod.id,
        type: paymentMethod.type,
        card: paymentMethod.card ? {
          brand: paymentMethod.card.brand,
          last4: paymentMethod.card.last4,
          exp_month: paymentMethod.card.exp_month,
          exp_year: paymentMethod.card.exp_year,
        } : undefined,
        created: paymentMethod.created,
        isDefault: setAsDefault || false,
      },
    });
  } catch (error) {
    console.error('Error adding payment method:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to add payment method' },
      { status: 500 }
    );
  }
}

// Update payment method (set as default) or delete
export async function PATCH(
  request: NextRequest
): Promise<NextResponse<ApiResponse<{ success: boolean }>>> {
  try {
    const body = await request.json();
    const { customerId, paymentMethodId, setAsDefault } = body;

    if (!customerId || !paymentMethodId) {
      return NextResponse.json(
        { success: false, error: 'customerId and paymentMethodId are required' },
        { status: 400 }
      );
    }

    if (setAsDefault) {
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: { success: true },
    });
  } catch (error) {
    console.error('Error updating payment method:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update payment method' },
      { status: 500 }
    );
  }
}

// Delete payment method
export async function DELETE(
  request: NextRequest
): Promise<NextResponse<ApiResponse<{ success: boolean }>>> {
  try {
    const { searchParams } = new URL(request.url);
    const paymentMethodId = searchParams.get('paymentMethodId');

    if (!paymentMethodId) {
      return NextResponse.json(
        { success: false, error: 'paymentMethodId is required' },
        { status: 400 }
      );
    }

    await stripe.paymentMethods.detach(paymentMethodId);

    return NextResponse.json({
      success: true,
      data: { success: true },
    });
  } catch (error) {
    console.error('Error deleting payment method:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to delete payment method' },
      { status: 500 }
    );
  }
}
