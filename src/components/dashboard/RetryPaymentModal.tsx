'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { InvoiceData, PaymentMethodData } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Modal, ModalFooter, Button } from '@/components/ui';
import { CreditCard, Plus, Check, RefreshCw, Loader2 } from 'lucide-react';
import { getStripePromise, fetchPublishableKey } from '@/lib/stripe-client';

interface RetryPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceData | null;
  paymentMethods: PaymentMethodData[];
  customerId?: string;
  accountId?: string;
  token?: string;
  onRetry: (data: {
    invoiceId: string;
    paymentMethodId?: string;
  }) => Promise<{ requiresAction?: boolean; clientSecret?: string; paymentIntentId?: string } | null>;
  onPaymentMethodAdded?: () => void;
}

// Main Retry Form Component
interface RetryFormProps {
  invoice: InvoiceData;
  paymentMethods: PaymentMethodData[];
  customerId: string;
  accountId?: string;
  token?: string;
  onRetry: RetryPaymentModalProps['onRetry'];
  onClose: () => void;
  onPaymentMethodAdded?: () => void;
  onSuccess: () => void;
  onError: (error: string) => void;
}

function RetryForm({ invoice, paymentMethods, customerId, accountId, token, onRetry, onClose, onPaymentMethodAdded, onSuccess, onError }: RetryFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [saveCard, setSaveCard] = useState(true);

  // Reset form when invoice changes
  useEffect(() => {
    if (invoice) {
      // Priority: 1) Invoice's assigned payment method, 2) Customer's default, 3) First available
      const invoicePm = invoice.default_payment_method
        ? paymentMethods.find(pm => pm.id === invoice.default_payment_method)
        : null;
      const defaultPm = paymentMethods.find(pm => pm.isDefault);
      setPaymentMethodId(invoicePm?.id || defaultPm?.id || paymentMethods[0]?.id || '');
      setShowAddCard(false);
    }
  }, [invoice, paymentMethods]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let pmIdToUse = paymentMethodId;

      // If adding new card, create payment method first
      if (showAddCard) {
        if (!stripe || !elements) {
          throw new Error('Stripe not loaded');
        }

        const cardElement = elements.getElement(CardElement);
        if (!cardElement) {
          throw new Error('Card element not found');
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

        pmIdToUse = paymentMethod.id;

        // If saving card, attach to customer via API
        if (saveCard) {
          let url = '/api/stripe/payment-methods';
          if (token) {
            url += `?token=${encodeURIComponent(token)}`;
          }
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customerId,
              paymentMethodId: pmIdToUse,
              setAsDefault: false,
              accountId,
            }),
          });

          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error);
          }
          onPaymentMethodAdded?.();
        }
      }

      const result = await onRetry({
        invoiceId: invoice.id,
        paymentMethodId: pmIdToUse || undefined,
      });

      // Check if 3DS authentication is required
      if (result?.requiresAction && result?.clientSecret) {
        if (!stripe) {
          throw new Error('Stripe not loaded');
        }

        // Handle 3DS authentication in browser
        const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
          result.clientSecret
        );

        if (confirmError) {
          throw new Error(confirmError.message);
        }

        if (paymentIntent?.status === 'succeeded') {
          onSuccess();
          return;
        }

        // Payment failed after 3DS - get specific error
        if (paymentIntent?.status === 'requires_payment_method') {
          throw new Error('Your card was declined. Please try a different payment method.');
        }

        throw new Error(`Payment failed with status: ${paymentIntent?.status || 'unknown'}. Please try again.`);
      }

      onSuccess();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to retry payment');
    } finally {
      setLoading(false);
    }
  };

  // Format the date when the invoice was first finalized/created
  const failedDate = new Date(invoice.created * 1000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <form onSubmit={handleSubmit}>
      {/* Invoice Summary */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Failed Date</span>
            <span className="text-sm text-gray-700">{failedDate}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Amount Due</span>
            <span className="font-semibold text-red-600">
              {formatCurrency(invoice.amount_due, invoice.currency)}
            </span>
          </div>
          {invoice.last_payment_error?.message && (
            <div className="mt-2 p-2 bg-red-50 rounded-lg">
              <p className="text-xs text-red-600">
                Last error: {invoice.last_payment_error.message}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* Payment Method Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Select Payment Method
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
          <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 space-y-3">
            <label className="block text-sm font-medium text-gray-700">
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
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveCard}
                onChange={(e) => setSaveCard(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">Save card for future payments</span>
            </label>
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" loading={loading} disabled={!paymentMethodId && !showAddCard}>
          <RefreshCw className="w-4 h-4" />
          Retry Payment
        </Button>
      </ModalFooter>
    </form>
  );
}

export function RetryPaymentModal({
  isOpen,
  onClose,
  invoice,
  paymentMethods,
  customerId,
  accountId,
  token,
  onRetry,
  onPaymentMethodAdded,
}: RetryPaymentModalProps) {
  const [result, setResult] = useState<{ type: 'success' | 'error'; message?: string } | null>(null);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Fetch publishable key when modal opens
  useEffect(() => {
    if (isOpen && accountId) {
      setLoadingKey(true);
      setKeyError(null);
      fetchPublishableKey(accountId, token)
        .then(key => {
          setPublishableKey(key);
        })
        .catch(err => {
          setKeyError(err instanceof Error ? err.message : 'Failed to load payment form');
        })
        .finally(() => {
          setLoadingKey(false);
        });
    }
  }, [isOpen, accountId, token]);

  // Create stripe promise when publishable key changes
  const stripePromise = useMemo(() => {
    if (!publishableKey) return null;
    return getStripePromise(publishableKey);
  }, [publishableKey]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setResult(null);
      setPublishableKey(null);
      setKeyError(null);
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
    <Modal isOpen={isOpen} onClose={onClose} title="Retry Payment" size="md">
      {loadingKey ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        </div>
      ) : keyError ? (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
          {keyError}
        </div>
      ) : stripePromise ? (
        <Elements stripe={stripePromise}>
          <RetryForm
            invoice={invoice}
            paymentMethods={paymentMethods}
            customerId={customerIdToUse}
            accountId={accountId}
            token={token}
            onRetry={onRetry}
            onClose={onClose}
            onPaymentMethodAdded={onPaymentMethodAdded}
            onSuccess={handleSuccess}
            onError={handleError}
          />
        </Elements>
      ) : (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
          Unable to initialize payment form. Please try again.
        </div>
      )}
    </Modal>
  );
}
