'use client';

import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Modal, ModalFooter, Button } from '@/components/ui';
import { CreditCard, Check, Plus, XCircle, Calendar } from 'lucide-react';
import { InvoiceData, PaymentMethodData } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface ChangePaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceData | null;
  invoices?: InvoiceData[]; // For bulk change
  paymentMethods: PaymentMethodData[];
  onChangePaymentMethod: (invoiceIds: string[], paymentMethodId: string) => Promise<void>;
  onPaymentMethodAdded?: () => void; // Callback to refresh payment methods
  customerId: string;
  accountId?: string;
  mode?: 'single' | 'bulk';
}

// Inner form component that uses Stripe hooks
function ChangePaymentMethodForm({
  isOpen,
  onClose,
  invoice,
  invoices = [],
  paymentMethods,
  onChangePaymentMethod,
  onPaymentMethodAdded,
  customerId,
  accountId,
  mode = 'single',
}: ChangePaymentMethodModalProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string>('');
  const [showAddCard, setShowAddCard] = useState(false);
  const [removeCard, setRemoveCard] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Pre-select the invoice's current payment method when modal opens
  useEffect(() => {
    if (isOpen && mode === 'single' && invoice?.default_payment_method) {
      setSelectedPaymentMethodId(invoice.default_payment_method);
    }
    if (isOpen) {
      setShowAddCard(false);
      setRemoveCard(false);
    }
  }, [isOpen, mode, invoice?.default_payment_method]);

  // For bulk mode, get all open/draft invoices
  const targetInvoices = mode === 'bulk'
    ? invoices.filter(inv => inv.status === 'open' || inv.status === 'draft')
    : invoice ? [invoice] : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (targetInvoices.length === 0) {
      setError('No payments to update');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let paymentMethodId = selectedPaymentMethodId;

      // If removing the card
      if (removeCard) {
        paymentMethodId = ''; // Empty string to remove the payment method
      }
      // If adding a new card, create it first
      else if (showAddCard) {
        if (!stripe || !elements) {
          setError('Stripe not loaded');
          return;
        }

        const cardElement = elements.getElement(CardElement);
        if (!cardElement) {
          setError('Card element not found');
          return;
        }

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

        // Attach to customer via our API
        const response = await fetch('/api/stripe/payment-methods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId,
            paymentMethodId: paymentMethod.id,
            setAsDefault: false,
            accountId,
          }),
        });

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error);
        }

        paymentMethodId = paymentMethod.id;
        onPaymentMethodAdded?.();
      } else if (!selectedPaymentMethodId) {
        setError('Please select a payment method');
        setLoading(false);
        return;
      }

      await onChangePaymentMethod(
        targetInvoices.map(inv => inv.id),
        paymentMethodId
      );
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change payment method');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSelectedPaymentMethodId('');
    setShowAddCard(false);
    setRemoveCard(false);
    setError('');
    onClose();
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        {/* Info */}
        <div className="bg-indigo-50 rounded-xl p-4 mb-6 border border-indigo-200">
          <div className="flex items-start gap-3">
            <CreditCard className="w-5 h-5 text-indigo-600 mt-0.5" />
            <div>
              <p className="font-medium text-indigo-800">
                {mode === 'bulk' ? 'Update All Payments' : 'Update Payment Method'}
              </p>
              <p className="text-sm text-indigo-600 mt-1">
                {mode === 'bulk'
                  ? `This will change the default payment method for ${targetInvoices.length} payment${targetInvoices.length !== 1 ? 's' : ''}.`
                  : 'Select a new payment method for this payment.'}
              </p>
            </div>
          </div>
        </div>

        {/* Invoice Summary for single mode */}
        {mode === 'single' && invoice && (() => {
          const paymentDate = invoice.metadata?.scheduledFinalizeAt
            ? parseInt(invoice.metadata.scheduledFinalizeAt, 10)
            : invoice.automatically_finalizes_at || invoice.due_date;
          return (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Amount</span>
                <span className="font-semibold text-gray-900">{formatCurrency(invoice.amount_due, invoice.currency)}</span>
              </div>
              {paymentDate && (
                <div className="flex justify-between items-center mt-1">
                  <span className="text-sm text-gray-600 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    Date
                  </span>
                  <span className="font-medium text-gray-700">
                    {formatDate(paymentDate)}
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Invoice Summary for bulk mode */}
        {mode === 'bulk' && targetInvoices.length > 0 && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200 max-h-32 overflow-y-auto">
            <p className="text-sm font-medium text-gray-700 mb-2">Payments to update:</p>
            {targetInvoices.map(inv => {
              const paymentDate = inv.metadata?.scheduledFinalizeAt
                ? parseInt(inv.metadata.scheduledFinalizeAt, 10)
                : inv.automatically_finalizes_at || inv.due_date;
              return (
                <div key={inv.id} className="flex justify-between items-center text-sm py-1">
                  <span className="text-gray-600 flex items-center gap-1">
                    {paymentDate && (
                      <>
                        <Calendar className="w-3 h-3" />
                        {formatDate(paymentDate)}
                      </>
                    )}
                  </span>
                  <span className="font-medium text-gray-900">{formatCurrency(inv.amount_due, inv.currency)}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Payment Method Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Select Payment Method
          </label>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {/* Add New Card Option */}
            <label
              className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${showAddCard ? 'bg-indigo-50' : 'hover:bg-gray-50'
                }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                checked={showAddCard}
                onChange={() => {
                  setShowAddCard(true);
                  setRemoveCard(false);
                  setSelectedPaymentMethodId('');
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

            {/* Remove Card Option */}
            <label
              className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${removeCard ? 'bg-red-50' : 'hover:bg-gray-50'
                }`}
            >
              <input
                type="radio"
                name="paymentMethod"
                checked={removeCard}
                onChange={() => {
                  setRemoveCard(true);
                  setShowAddCard(false);
                  setSelectedPaymentMethodId('');
                }}
                className="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
              />
              <div className="w-10 h-6 rounded flex items-center justify-center bg-red-100">
                <XCircle className="w-4 h-4 text-red-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">No Payment Method</p>
                <p className="text-xs text-gray-500">Auto-payment will fail</p>
              </div>
              {removeCard && <Check className="w-4 h-4 text-red-600" />}
            </label>

            {/* Existing Payment Methods */}
            {paymentMethods.map((pm) => (
              <label
                key={pm.id}
                className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${!showAddCard && !removeCard && selectedPaymentMethodId === pm.id
                    ? 'bg-indigo-50'
                    : 'hover:bg-gray-50'
                  }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={pm.id}
                  checked={!showAddCard && !removeCard && selectedPaymentMethodId === pm.id}
                  onChange={(e) => {
                    setSelectedPaymentMethodId(e.target.value);
                    setShowAddCard(false);
                    setRemoveCard(false);
                  }}
                  className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                />
                <div className={`w-10 h-6 rounded flex items-center justify-center ${pm.isDefault ? 'bg-indigo-100' : 'bg-gray-100'
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
                {!showAddCard && !removeCard && selectedPaymentMethodId === pm.id && (
                  <Check className="w-4 h-4 text-indigo-600" />
                )}
              </label>
            ))}
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

        {error && (
          <div className="mt-4 bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <ModalFooter>
          <Button variant="secondary" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!showAddCard && !removeCard && !selectedPaymentMethodId}
            variant={removeCard ? 'danger' : 'primary'}
          >
            {removeCard ? <XCircle className="w-4 h-4" /> : showAddCard ? <Plus className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
            {removeCard ? 'Remove Card' : showAddCard ? 'Add & Set Card' : (mode === 'bulk' ? 'Update All' : 'Update')}
          </Button>
        </ModalFooter>
      </form>
    </>
  );
}

// Main wrapper component with Stripe Elements
export function ChangePaymentMethodModal(props: ChangePaymentMethodModalProps) {
  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} title={
      props.mode === 'bulk'
        ? `Change Payment Method (${(props.invoices || []).filter(inv => inv.status === 'open' || inv.status === 'draft').length})`
        : `Change Payment Method${props.invoice?.number ? ` - ${props.invoice.number}` : ''}`
    } size="md">
      <Elements stripe={stripePromise}>
        <ChangePaymentMethodForm {...props} />
      </Elements>
    </Modal>
  );
}
