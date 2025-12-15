'use client';

import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { InvoiceData, PaymentMethodData } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Modal, ModalFooter, Button, Input } from '@/components/ui';
import { CreditCard, Plus, ChevronLeft, Check } from 'lucide-react';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface PayInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceData | null;
  paymentMethods: PaymentMethodData[];
  customerId?: string;
  onPay: (data: {
    invoiceId: string;
    amount: number;
    paymentMethodId: string;
    note?: string;
    applyToInvoice?: boolean;
  }) => Promise<void>;
  onPaymentMethodAdded?: () => void;
}

// Add New Card Form Component
interface AddCardFormProps {
  customerId: string;
  onSuccess: (paymentMethodId: string) => void;
  onCancel: () => void;
}

function AddCardForm({ customerId, onSuccess, onCancel }: AddCardFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saveCard, setSaveCard] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Create payment method
      const { error: stripeError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (stripeError) {
        throw new Error(stripeError.message);
      }

      if (!paymentMethod) {
        throw new Error('Failed to create payment method');
      }

      // If saving card, attach to customer via API
      if (saveCard) {
        const response = await fetch('/api/stripe/payment-methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId,
            paymentMethodId: paymentMethod.id,
            setAsDefault: false,
          }),
        });

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error);
        }
      }

      onSuccess(paymentMethod.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add card');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <button
        type="button"
        onClick={onCancel}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to payment options
      </button>

      <div className="space-y-4">
        {/* Card Element */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Card Details
          </label>
          <div className="border border-gray-300 rounded-lg p-4 bg-white">
            <CardElement
              options={{
                style: {
                  base: {
                    fontSize: '16px',
                    color: '#1f2937',
                    '::placeholder': {
                      color: '#9ca3af',
                    },
                  },
                  invalid: {
                    color: '#ef4444',
                  },
                },
              }}
            />
          </div>
        </div>

        {/* Save Card Option */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={saveCard}
            onChange={(e) => setSaveCard(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-700">Save card for future payments</span>
        </label>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" loading={loading} disabled={!stripe}>
          <CreditCard className="w-4 h-4" />
          {saveCard ? 'Save & Use Card' : 'Pay Without Saving'}
        </Button>
      </ModalFooter>
    </form>
  );
}

// Main Pay Invoice Form Component
interface PayFormProps {
  invoice: InvoiceData;
  paymentMethods: PaymentMethodData[];
  customerId: string;
  onPay: PayInvoiceModalProps['onPay'];
  onClose: () => void;
  onPaymentMethodAdded?: () => void;
  onSuccess: () => void;
  onError: (error: string) => void;
}

function PayForm({ invoice, paymentMethods, customerId, onPay, onClose, onPaymentMethodAdded, onSuccess, onError }: PayFormProps) {
  const [amount, setAmount] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [applyToInvoice, setApplyToInvoice] = useState(true);

  // Reset form when invoice changes
  useEffect(() => {
    if (invoice) {
      // Default amount to the remaining amount
      setAmount((invoice.amount_remaining / 100).toFixed(2));
      // Priority: 1) Invoice's assigned payment method, 2) Customer's default, 3) First available
      const invoicePm = invoice.default_payment_method
        ? paymentMethods.find(pm => pm.id === invoice.default_payment_method)
        : null;
      const defaultPm = paymentMethods.find(pm => pm.isDefault);
      setPaymentMethodId(invoicePm?.id || defaultPm?.id || paymentMethods[0]?.id || '');
      setNote('');
      setApplyToInvoice(true);
    }
  }, [invoice, paymentMethods]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payAmount = amount ? Math.round(parseFloat(amount) * 100) : invoice.amount_remaining;

    if (payAmount <= 0) {
      onError('Amount must be greater than 0');
      return;
    }

    // Only check max amount if applying to invoice
    if (applyToInvoice && payAmount > invoice.amount_remaining) {
      onError('Amount cannot exceed remaining balance');
      return;
    }

    if (!paymentMethodId) {
      onError('Please select a payment method or add a new card');
      return;
    }

    setLoading(true);

    try {
      await onPay({
        invoiceId: invoice.id,
        amount: payAmount,
        paymentMethodId,
        note: note.trim() || undefined,
        applyToInvoice,
      });
      onSuccess();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to process payment');
    } finally {
      setLoading(false);
    }
  };

  const handleCardAdded = (newPaymentMethodId: string) => {
    setPaymentMethodId(newPaymentMethodId);
    setShowAddCard(false);
    onPaymentMethodAdded?.();
  };

  // Show add card form
  if (showAddCard) {
    return (
      <AddCardForm
        customerId={customerId}
        onSuccess={handleCardAdded}
        onCancel={() => setShowAddCard(false)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Invoice Summary with checkbox */}
      <div className={`rounded-xl p-4 mb-6 ${applyToInvoice ? 'bg-gray-50' : 'bg-blue-50 border border-blue-200'}`}>
        <label className="flex items-center gap-3 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={applyToInvoice}
            onChange={(e) => setApplyToInvoice(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm font-medium text-gray-700">Apply payment to this invoice</span>
        </label>
        <div className={`space-y-2 ${!applyToInvoice ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Invoice</span>
            <span className="font-mono text-sm">{invoice.number || invoice.id.slice(0, 12)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Total Amount</span>
            <span className="font-semibold">
              {formatCurrency(invoice.amount_due, invoice.currency)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Remaining</span>
            <span className="font-semibold text-amber-600">
              {formatCurrency(invoice.amount_remaining, invoice.currency)}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Payment Amount */}
        <Input
          label="Payment Amount"
          type="number"
          step="0.01"
          min="0.01"
          max={(invoice.amount_remaining / 100).toFixed(2)}
          placeholder={(invoice.amount_remaining / 100).toFixed(2)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          hint="Enter the amount to pay"
        />

        {/* Payment Method Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Payment Method
          </label>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {/* Existing Payment Methods */}
            {paymentMethods.map((pm) => (
              <label
                key={pm.id}
                className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                  !showAddCard && paymentMethodId === pm.id
                    ? 'bg-indigo-50'
                    : 'hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={pm.id}
                  checked={!showAddCard && paymentMethodId === pm.id}
                  onChange={(e) => {
                    setPaymentMethodId(e.target.value);
                    setShowAddCard(false);
                  }}
                  className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                />
                <div className={`w-10 h-6 rounded flex items-center justify-center ${
                  pm.isDefault ? 'bg-indigo-100' : 'bg-gray-100'
                }`}>
                  <CreditCard className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    <span className="capitalize">{pm.card?.brand}</span>
                    {' •••• '}
                    {pm.card?.last4}
                  </p>
                  <p className="text-xs text-gray-500">
                    Exp {pm.card?.exp_month.toString().padStart(2, '0')}/{pm.card?.exp_year}
                  </p>
                </div>
                {pm.isDefault && (
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">
                    Default
                  </span>
                )}
                {!showAddCard && paymentMethodId === pm.id && (
                  <Check className="w-4 h-4 text-indigo-600" />
                )}
              </label>
            ))}

            {/* Add New Card Option */}
            <label
              className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                showAddCard ? 'bg-indigo-50' : 'hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                checked={showAddCard}
                onChange={() => {
                  setShowAddCard(true);
                  setPaymentMethodId('');
                }}
                className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
              />
              <div className="w-10 h-6 rounded flex items-center justify-center bg-green-100">
                <Plus className="w-4 h-4 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">Add New Card</p>
                <p className="text-xs text-gray-500">Enter new card details</p>
              </div>
              {showAddCard && <Check className="w-4 h-4 text-indigo-600" />}
            </label>
          </div>
        </div>

        {/* Add New Card Form */}
        {showAddCard && (
          <div className="mt-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Card Details
            </label>
            <div className="border border-gray-300 rounded-lg p-4 bg-white">
              <CardElement
                options={{
                  style: {
                    base: {
                      fontSize: '16px',
                      color: '#1f2937',
                      '::placeholder': {
                        color: '#9ca3af',
                      },
                    },
                    invalid: {
                      color: '#ef4444',
                    },
                  },
                }}
              />
            </div>
          </div>
        )}

        {/* Note */}
        <Input
          label="Note (optional)"
          type="text"
          placeholder="Add a note for this payment..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" loading={loading} disabled={!paymentMethodId}>
          <CreditCard className="w-4 h-4" />
          {applyToInvoice
            ? `Pay ${amount ? formatCurrency(parseFloat(amount) * 100, invoice.currency) : 'Full Amount'}`
            : 'Add Credit'}
        </Button>
      </ModalFooter>
    </form>
  );
}

export function PayInvoiceModal({
  isOpen,
  onClose,
  invoice,
  paymentMethods,
  customerId,
  onPay,
  onPaymentMethodAdded,
}: PayInvoiceModalProps) {
  const [result, setResult] = useState<{ type: 'success' | 'error'; message?: string } | null>(null);

  // Reset result when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setResult(null);
    }
  }, [isOpen]);

  if (!invoice) return null;

  // Get customerId from invoice if not provided directly
  const customerIdToUse = customerId || invoice.customer;

  const handleClose = () => {
    setResult(null);
    onClose();
  };

  const handleSuccess = () => {
    setResult({ type: 'success' });
  };

  const handleError = (error: string) => {
    setResult({ type: 'error', message: error });
  };

  // Format date and amount for title
  const invoiceDate = invoice.due_date || invoice.created;
  const formattedDate = formatDate(invoiceDate);
  const formattedAmount = formatCurrency(invoice.amount_remaining, invoice.currency);
  const modalTitle = `${formattedDate} - ${formattedAmount}`;

  // Show success modal
  if (result?.type === 'success') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-green-50 p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-green-900 mb-2">
              Payment Successful
            </h3>
            <p className="text-sm text-green-700">
              The payment has been processed successfully.
            </p>
          </div>
          <div className="p-4">
            <button
              type="button"
              onClick={handleClose}
              className="w-full px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show error modal
  if (result?.type === 'error') {
    const error = result.message || 'Payment failed';
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="bg-red-50 p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <CreditCard className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-red-900 mb-2">
              {error.toLowerCase().includes('declined') ? 'Card Declined' : 'Payment Failed'}
            </h3>
            <p className="text-sm text-red-700">{error}</p>
          </div>
          {error.toLowerCase().includes('declined') && (
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
              <p className="text-xs text-gray-600 mb-2 font-medium">What you can do:</p>
              <ul className="text-xs text-gray-500 space-y-1">
                <li>• Try a different payment card</li>
                <li>• Check your card details are correct</li>
                <li>• Contact your bank for more information</li>
              </ul>
            </div>
          )}
          <div className="p-4 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show main form modal
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={modalTitle} size="md">
      <Elements stripe={stripePromise}>
        <PayForm
          invoice={invoice}
          paymentMethods={paymentMethods}
          customerId={customerIdToUse}
          onPay={onPay}
          onClose={onClose}
          onPaymentMethodAdded={onPaymentMethodAdded}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      </Elements>
    </Modal>
  );
}
