import { NextRequest, NextResponse } from 'next/server';
import stripe from '@/lib/stripe';
import { ApiResponse } from '@/types';

interface AddCreditResult {
  creditTransactionId: string;
  totalCreditAdded: number;
  invoicesPaid: Array<{
    invoiceId: string;
    invoiceNumber: string | null;
    amountApplied: number;
  }>;
  remainingCredit: number;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResponse<AddCreditResult>>> {
  try {
    const body = await request.json();
    const {
      customerId,
      amount,
      currency,
      reason,
      invoiceUID,
      selectedInvoiceIds,
      applyToAll,
    } = body;

    if (!customerId || !amount || !reason) {
      return NextResponse.json(
        { success: false, error: 'customerId, amount, and reason are required' },
        { status: 400 }
      );
    }

    // First, add the credit to customer balance
    const creditTransaction = await stripe.customers.createBalanceTransaction(customerId, {
      amount: -Math.abs(amount), // Negative = credit
      currency: currency || 'usd',
      description: `Credit added: ${reason}`,
      metadata: {
        reason,
        InvoiceUID: invoiceUID,
        creditType: 'manual_credit',
      },
    });

    let remainingCredit = Math.abs(amount);
    const invoicesPaid: AddCreditResult['invoicesPaid'] = [];

    // Get invoices to pay if any selected
    let invoicesToPay: string[] = [];

    if (selectedInvoiceIds && selectedInvoiceIds.length > 0) {
      // Pay specific invoices in order
      invoicesToPay = selectedInvoiceIds;
    } else if (applyToAll) {
      // Get all open and draft invoices with the same InvoiceUID, sorted by due date
      const [openInvoices, draftInvoices] = await Promise.all([
        stripe.invoices.list({
          customer: customerId,
          status: 'open',
          limit: 100,
        }),
        stripe.invoices.list({
          customer: customerId,
          status: 'draft',
          limit: 100,
        }),
      ]);

      const allInvoices = [...openInvoices.data, ...draftInvoices.data];

      invoicesToPay = allInvoices
        .filter(inv => inv.metadata?.InvoiceUID === invoiceUID || inv.metadata?.invoiceUID === invoiceUID)
        .sort((a, b) => (a.due_date || 0) - (b.due_date || 0))
        .map(inv => inv.id);
    }

    // Apply credit to invoices sequentially
    for (const invoiceId of invoicesToPay) {
      if (remainingCredit <= 0) break;

      let invoice = await stripe.invoices.retrieve(invoiceId);

      // Get the amount to work with based on invoice status
      let invoiceAmount = 0;
      if (invoice.status === 'draft') {
        invoiceAmount = invoice.amount_due || 0;
      } else if (invoice.status === 'open') {
        invoiceAmount = invoice.amount_remaining || 0;
      } else {
        continue; // Skip paid/void invoices
      }

      if (invoiceAmount <= 0) continue;

      const amountToApply = Math.min(remainingCredit, invoiceAmount);

      // Build payment history from existing metadata
      const existingPayments = invoice.metadata?.paymentHistory
        ? JSON.parse(invoice.metadata.paymentHistory)
        : [];

      // Add new credit to history
      const newPayment = {
        creditTransactionId: creditTransaction.id,
        amount: amountToApply,
        reason,
        date: Date.now(),
        type: 'credit',
      };
      existingPayments.push(newPayment);

      // Calculate total paid from history
      const totalPaid = existingPayments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0);

      try {
        if (invoice.status === 'draft') {
          // For draft invoices: update metadata to track credit, but don't finalize yet
          await stripe.invoices.update(invoiceId, {
            metadata: {
              ...invoice.metadata,
              paymentHistory: JSON.stringify(existingPayments),
              totalPaid: totalPaid.toString(),
              lastCreditApplied: amountToApply.toString(),
              lastCreditReason: reason,
              lastCreditDate: Date.now().toString(),
              creditTransactionId: creditTransaction.id,
            },
          });

          invoicesPaid.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            amountApplied: amountToApply,
          });

          remainingCredit -= amountToApply;
        } else {
          // For open invoices: try to pay using the credit balance
          // Update invoice metadata with payment history first
          await stripe.invoices.update(invoiceId, {
            metadata: {
              ...invoice.metadata,
              paymentHistory: JSON.stringify(existingPayments),
              totalPaid: totalPaid.toString(),
              lastCreditApplied: amountToApply.toString(),
              lastCreditReason: reason,
              lastCreditDate: Date.now().toString(),
              creditTransactionId: creditTransaction.id,
            },
          });

          // Try to pay the invoice using the credit balance
          try {
            await stripe.invoices.pay(invoiceId);
          } catch {
            // Partial payment - invoice remains open with reduced amount_remaining
            console.log('Partial credit applied to invoice:', invoiceId);
          }

          invoicesPaid.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.number,
            amountApplied: amountToApply,
          });

          remainingCredit -= amountToApply;
        }
      } catch (payError) {
        console.error('Failed to apply credit to invoice:', invoiceId, payError);
      }
    }

    // Update the credit transaction metadata with results
    // Note: Balance transactions can't be updated, but we track via invoices

    return NextResponse.json({
      success: true,
      data: {
        creditTransactionId: creditTransaction.id,
        totalCreditAdded: Math.abs(amount),
        invoicesPaid,
        remainingCredit,
      },
    });
  } catch (error) {
    console.error('Error adding credit:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to add credit' },
      { status: 500 }
    );
  }
}
