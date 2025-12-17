import Stripe from 'stripe';

export interface CustomerData {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  balance: number;
  currency: string;
  created: number;
  metadata: Record<string, string>;
  defaultPaymentMethod: PaymentMethodData | null;
}

export interface InvoiceData {
  id: string;
  number: string | null;
  status: Stripe.Invoice.Status | null;
  amount_due: number;
  amount_paid: number;
  amount_remaining: number;
  currency: string;
  due_date: number | null;
  created: number;
  description: string | null;
  customer: string;
  metadata: Record<string, string>;
  hosted_invoice_url: string | null;
  pdf: string | null;
  lines: InvoiceLineItem[];
  isPaused?: boolean;
  originalDueDate?: number;
  adjustmentNote?: string;
  default_payment_method: string | null;
  // User note
  note?: string;
  // Payment failure info
  last_payment_error?: {
    code: string | null;
    message: string | null;
    decline_code: string | null;
  } | null;
  next_payment_attempt: number | null;
  attempt_count: number;
  // Draft invoice scheduling
  auto_advance: boolean;
  automatically_finalizes_at: number | null;
  // Finalization timestamp (when invoice became open)
  effective_at: number | null;
}

export interface InvoiceLineItem {
  id: string;
  description: string | null;
  amount: number;
  currency: string;
  quantity: number | null;
}

export interface PaymentData {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  status: string;
  created: number;
  invoice: string | null;
  invoiceNumber: string | null;
  payment_method_types: string[];
  refunded: boolean;
  metadata: Record<string, string>;
  customer: string | null;
  description: string | null;
  refund_reason: string | null;
}

export interface PaymentMethodData {
  id: string;
  type: string;
  card?: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
  created: number;
  isDefault: boolean;
}

export interface RefundData {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  payment_intent: string;
  reason: string | null;
}

export interface CreditBalanceTransaction {
  id: string;
  amount: number;
  currency: string;
  created: number;
  description: string | null;
  type: string;
  ending_balance: number;
}

export interface DashboardData {
  customer: CustomerData;
  invoices: InvoiceData[];
  payments: PaymentData[];
  paymentMethods: PaymentMethodData[];
  creditTransactions: CreditBalanceTransaction[];
}

// API Request/Response types
export interface PartialPaymentRequest {
  invoiceId: string;
  amount: number;
  paymentMethodId?: string;
}

export interface VoidInvoiceRequest {
  invoiceId: string;
  addCredit: boolean;
  reason?: string;
}

export interface AdjustInvoiceRequest {
  invoiceId: string;
  newAmount: number;
  reason: string;
}

export interface PauseInvoiceRequest {
  invoiceId: string;
  pause: boolean;
}

export interface RefundRequest {
  paymentIntentId: string;
  amount?: number;
  reason?: string;
}

export interface OneTimePaymentRequest {
  amount: number;
  currency: string;
  paymentMethodId: string;
  customerId?: string;
  description?: string;
  saveCard?: boolean;
}

export interface AddCreditRequest {
  customerId: string;
  amount: number;
  description?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Extended customer info from external system
export interface ExtendedCustomerInfo {
  fatherName?: string;
  fatherEmail?: string;
  fatherCell?: string;
  motherName?: string;
  motherEmail?: string;
  motherCell?: string;
  // Payment summary info
  totalAmount?: number;
  paymentName?: string;
}

// Other payments (Zelle, Cash, etc.) from external system
export interface OtherPayment {
  paymentDate: string;
  amount: number;
  paymentType: string;
  description: string;
}
