'use client';

import { useState, useEffect } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { CreditCard, Loader2, CheckCircle, AlertCircle, Lock } from 'lucide-react';
import { PaymentMethodData } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { getStripePromise } from '@/lib/stripe-client';

interface PayLinkFormProps {
  token: string;
  accountId: string;
  amount: number; // cents, fixed by the signed token
  customerName: string;
  description: string;
  publishableKey: string;
  savedMethods: PaymentMethodData[];
}

const cardStyle = {
  style: {
    base: {
      fontSize: '16px',
      color: '#1f2937',
      '::placeholder': { color: '#9ca3af' },
    },
    invalid: { color: '#dc2626' },
  },
};

function InnerForm({ token, amount, savedMethods, onPaid }: {
  token: string;
  amount: number;
  savedMethods: PaymentMethodData[];
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // "new" => collect a new card; otherwise a saved payment-method id.
  const defaultId = savedMethods.find(m => m.isDefault)?.id || savedMethods[0]?.id || 'new';
  const [selected, setSelected] = useState<string>(defaultId);
  const [saveCard, setSaveCard] = useState(false);

  const finalizeAfter3DS = async (paymentIntentId: string) => {
    const res = await fetch(`/api/stripe/pay-link/finalize?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIntentId }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Failed to complete payment');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe) return;
    setLoading(true);
    setError('');

    try {
      let paymentMethodId = selected;

      // New card: tokenize via Stripe Elements (card never touches our server).
      if (selected === 'new') {
        if (!elements) return;
        const cardElement = elements.getElement(CardElement);
        if (!cardElement) return;
        const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
          type: 'card',
          card: cardElement,
        });
        if (pmError) throw new Error(pmError.message);
        if (!paymentMethod) throw new Error('Could not read card details');
        paymentMethodId = paymentMethod.id;
      }

      // Charge. Amount/customer come from the signed token server-side.
      const res = await fetch(`/api/stripe/pay-link?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethodId,
          saveCard: selected === 'new' ? saveCard : false,
        }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Payment failed');

      // 3DS path
      if (result.data?.requiresAction && result.data?.clientSecret) {
        const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
          result.data.clientSecret
        );
        if (confirmError) throw new Error(confirmError.message);
        if (paymentIntent?.status !== 'succeeded') {
          throw new Error('Your card could not be authorized. Please try another card.');
        }
        await finalizeAfter3DS(result.data.paymentIntentId);
      }

      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {savedMethods.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700">Pay with</p>
          {savedMethods.map((m) => (
            <label
              key={m.id}
              className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                selected === m.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="pm"
                checked={selected === m.id}
                onChange={() => setSelected(m.id)}
                className="w-4 h-4 text-indigo-600"
              />
              <CreditCard className="w-5 h-5 text-gray-500" />
              <span className="text-sm text-gray-800">
                {m.card ? `${m.card.brand.toUpperCase()} •••• ${m.card.last4}` : m.type}
              </span>
              {m.isDefault && <span className="ml-auto text-xs text-indigo-600">Default</span>}
            </label>
          ))}
          <label
            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              selected === 'new' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              name="pm"
              checked={selected === 'new'}
              onChange={() => setSelected('new')}
              className="w-4 h-4 text-indigo-600"
            />
            <CreditCard className="w-5 h-5 text-gray-500" />
            <span className="text-sm text-gray-800">Use a new card</span>
          </label>
        </div>
      )}

      {selected === 'new' && (
        <div className="space-y-2">
          <div className="p-3 border border-gray-300 rounded-xl bg-white">
            <CardElement options={cardStyle} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={saveCard}
              onChange={(e) => setSaveCard(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded"
            />
            Save this card for future payments
          </label>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2.5 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !stripe}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" /> Processing…
          </>
        ) : (
          <>
            <Lock className="w-4 h-4" /> Pay {formatCurrency(amount, 'usd')}
          </>
        )}
      </button>

      <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
        <Lock className="w-3 h-3" /> Secured by Stripe
      </p>
    </form>
  );
}

export function PayLinkForm(props: PayLinkFormProps) {
  const [paid, setPaid] = useState(false);
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof getStripePromise> | null>(null);

  useEffect(() => {
    setStripePromise(getStripePromise(props.publishableKey));
  }, [props.publishableKey]);

  if (paid) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-9 h-9 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Payment Successful</h2>
        <p className="text-gray-600 text-sm">
          Thank you! Your payment of {formatCurrency(props.amount, 'usd')} has been received.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-gray-500">{props.description || 'Amount due'}</p>
        <p className="text-3xl font-bold text-gray-900">{formatCurrency(props.amount, 'usd')}</p>
      </div>
      {stripePromise && (
        <Elements stripe={stripePromise}>
          <InnerForm
            token={props.token}
            amount={props.amount}
            savedMethods={props.savedMethods}
            onPaid={() => setPaid(true)}
          />
        </Elements>
      )}
    </div>
  );
}
