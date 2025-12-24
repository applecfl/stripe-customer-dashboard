'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Modal, ModalFooter, Button } from '@/components/ui';
import { CreditCard, Plus } from 'lucide-react';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

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
  const handleSuccess = () => {
    onSuccess();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Payment Method" size="md">
      <Elements stripe={stripePromise}>
        <AddPaymentMethodForm
          customerId={customerId}
          accountId={accountId}
          token={token}
          onSuccess={handleSuccess}
          onCancel={onClose}
        />
      </Elements>
    </Modal>
  );
}
