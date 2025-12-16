import Stripe from 'stripe';
import { InvoiceData, PaymentData } from '@/types';

export function mapInvoice(invoice: Stripe.Invoice): InvoiceData {
  // Extract last payment error from the invoice's last_finalization_error or charge
  const lastPaymentError = invoice.last_finalization_error ? {
    code: invoice.last_finalization_error.code ?? null,
    message: invoice.last_finalization_error.message ?? null,
    decline_code: (invoice.last_finalization_error as unknown as { decline_code?: string })?.decline_code ?? null,
  } : null;

  return {
    id: invoice.id,
    number: invoice.number ?? null,
    status: invoice.status,
    amount_due: invoice.amount_due ?? 0,
    amount_paid: invoice.amount_paid ?? 0,
    amount_remaining: invoice.amount_remaining ?? 0,
    currency: invoice.currency,
    due_date: invoice.due_date ?? null,
    created: invoice.created,
    description: invoice.description ?? null,
    customer: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '',
    metadata: invoice.metadata || {},
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    pdf: invoice.invoice_pdf ?? null,
    lines: invoice.lines?.data.map((line) => ({
      id: line.id,
      description: line.description ?? null,
      amount: line.amount,
      currency: line.currency,
      quantity: line.quantity ?? null,
    })) || [],
    isPaused: invoice.metadata?.isPaused === 'true',
    originalDueDate: invoice.metadata?.originalDueDate ? parseInt(invoice.metadata.originalDueDate) : undefined,
    adjustmentNote: invoice.metadata?.adjustmentNote,
    default_payment_method: typeof invoice.default_payment_method === 'string'
      ? invoice.default_payment_method
      : invoice.default_payment_method?.id ?? null,
    last_payment_error: lastPaymentError,
    next_payment_attempt: invoice.next_payment_attempt ?? null,
    attempt_count: invoice.attempt_count ?? 0,
    auto_advance: invoice.auto_advance ?? false,
    automatically_finalizes_at: invoice.automatically_finalizes_at ?? null,
    effective_at: invoice.effective_at ?? null,
  };
}

export function mapPaymentIntent(
  pi: Stripe.PaymentIntent,
  invoiceNumber?: string | null,
  refundInfo?: { amount: number; reason: string | null }
): PaymentData {
  // Use type assertion since invoice exists on PaymentIntent but may not be in all type definitions
  const piInvoice = (pi as unknown as { invoice?: string | { id: string } | null }).invoice;
  return {
    id: pi.id,
    amount: pi.amount,
    amount_refunded: refundInfo?.amount ?? (pi.amount - (pi.amount_received || 0)),
    currency: pi.currency,
    status: pi.status,
    created: pi.created,
    invoice: typeof piInvoice === 'string' ? piInvoice : piInvoice?.id || null,
    invoiceNumber: invoiceNumber ?? null,
    payment_method_types: pi.payment_method_types,
    refunded: pi.metadata?.refunded === 'true',
    metadata: pi.metadata || {},
    customer: typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null,
    description: pi.description ?? null,
    refund_reason: refundInfo?.reason ?? null,
  };
}
