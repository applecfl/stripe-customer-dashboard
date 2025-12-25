'use client';

import { useState, useEffect, useMemo } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Modal, ModalFooter, Button } from '@/components/ui';
import { CreditCard, Plus, Loader2 } from 'lucide-react';

// Cache for Stripe instances per publishable key
const stripePromiseCache: Map<string, Promise<Stripe | null>> = new Map();

function getStripePromise(publishableKey: string): Promise<Stripe | null> {
  if (!stripePromiseCache.has(publishableKey)) {
    stripePromiseCache.set(publishableKey, loadStripe(publishableKey));
  }
  return stripePromiseCache.get(publishableKey)!;
}

interface AddPaymentMethodFormProps {
  customerId: string;
  accountId?: string;
  token?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function AddPaymentMethodForm({ customerId, accountId, token, onSuccess, onCancel }: AddPaymentMethodFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [setAsDefault, setSetAsDefault] = useState(true);

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

      // Attach to customer via our API
      let url = '/api/stripe/payment-methods';
      if (token) {
        url += `?token=${encodeURIComponent(token)}`;
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          paymentMethodId: paymentMethod.id,
          setAsDefault,
          accountId,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add card');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Info */}
      <div className="bg-indigo-50 rounded-xl p-4 mb-6 border border-indigo-200">
        <div className="flex items-start gap-3">
          <CreditCard className="w-5 h-5 text-indigo-600 mt-0.5" />
          <div>
            <p className="font-medium text-indigo-800">Add New Card</p>
            <p className="text-sm text-indigo-600 mt-1">
              Enter card details to add a new payment method.
            </p>
          </div>
        </div>
      </div>

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

        {/* Set as Default */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={setAsDefault}
            onChange={(e) => setSetAsDefault(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-700">Set as default payment method</span>
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
          <Plus className="w-4 h-4" />
          Add Card
        </Button>
      </ModalFooter>
    </form>
  );
}

interface AddPaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  accountId?: string;
  token?: string;
  onSuccess: () => void;
}

export function AddPaymentMethodModal({
  isOpen,
  onClose,
  customerId,
  accountId,
  token,
  onSuccess,
}: AddPaymentMethodModalProps) {
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Fetch publishable key when modal opens
  useEffect(() => {
    if (isOpen && accountId) {
      setLoadingKey(true);
      setKeyError(null);

      fetch(`/api/stripe/account-info?accountId=${encodeURIComponent(accountId)}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data?.publishableKey) {
            setPublishableKey(data.data.publishableKey);
          } else {
            // Fallback to env variable
            setPublishableKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null);
          }
        })
        .catch(() => {
          // Fallback to env variable on error
          setPublishableKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null);
        })
        .finally(() => {
          setLoadingKey(false);
        });
    } else if (isOpen && !accountId) {
      // No accountId, use default
      setPublishableKey(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || null);
    }
  }, [isOpen, accountId]);

  // Create stripe promise when publishable key changes
  const stripePromise = useMemo(() => {
    if (!publishableKey) return null;
    return getStripePromise(publishableKey);
  }, [publishableKey]);

  const handleSuccess = () => {
    onSuccess();
    onClose();
  };

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPublishableKey(null);
      setKeyError(null);
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Payment Method" size="md">
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
          <AddPaymentMethodForm
            customerId={customerId}
            accountId={accountId}
            token={token}
            onSuccess={handleSuccess}
            onCancel={onClose}
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
