'use client';

import { useState, useEffect } from 'react';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { CreditCard, Loader2, CheckCircle, AlertCircle, Lock, CalendarClock } from 'lucide-react';
import { PaymentMethodData } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { getStripePromise } from '@/lib/stripe-client';
import { buildPlan, maxMonthlyInstallments, Installment } from '@/lib/installments';

interface PaymentPlanConfig {
  maxInstallments: number;
  endDate: number; // unix seconds
}

interface PayLinkFormProps {
  token: string;
  accountId: string;
  amount: number; // cents — fixed link: the charge; dynamic link: the live balance (cap)
  dynamic?: boolean; // when true, customer may edit the amount up to `amount`
  customerName: string;
  description: string;
  publishableKey: string;
  savedMethods: PaymentMethodData[];
  plan?: PaymentPlanConfig; // when present, offer a monthly installment plan
  nowSec?: number; // server "now" (unix s) so plan dates match the backend
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

function InnerForm({ token, amount, dynamic, savedMethods, plan, nowSec, onPaid }: {
  token: string;
  amount: number; // dynamic: the live balance (cap); fixed: the exact charge
  dynamic?: boolean;
  savedMethods: PaymentMethodData[];
  plan?: PaymentPlanConfig;
  nowSec?: number;
  onPaid: (paidCents: number, planCount?: number, installments?: Installment[]) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // "new" => collect a new card; otherwise a saved payment-method id.
  const defaultId = savedMethods.find(m => m.isDefault)?.id || savedMethods[0]?.id || 'new';
  const [selected, setSelected] = useState<string>(defaultId);
  const [saveCard, setSaveCard] = useState(false);

  // ── Installment plan chooser ────────────────────────────────────────────────
  // A plan link caps the real number of monthly payments by its end date. `planMax`
  // is the true ceiling; the customer picks 1..planMax (1 = pay in full today).
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  const planMax = plan ? Math.min(plan.maxInstallments, maxMonthlyInstallments(now, plan.endDate)) : 0;
  const hasPlan = !!plan && planMax >= 2;
  // 'full' or 'split'; when split, planCount is how many monthly payments.
  const [payChoice, setPayChoice] = useState<'full' | 'split'>('full');
  const [planCount, setPlanCount] = useState(Math.min(2, planMax || 2));
  const usingPlan = hasPlan && payChoice === 'split';
  const installments: Installment[] = usingPlan ? buildPlan(amount, planCount, now, plan!.endDate) : [];

  // A plan link disables the free-amount editor (plan is all-or-nothing on #1).
  // Dynamic links: editable amount (defaults to the full balance), capped at it.
  const [amountInput, setAmountInput] = useState((amount / 100).toFixed(2));
  const chosenCents = usingPlan
    ? installments[0]?.amount ?? amount
    : (dynamic && !hasPlan ? Math.round((parseFloat(amountInput) || 0) * 100) : amount);

  const finalizeAfter3DS = async (paymentIntentId: string): Promise<number> => {
    const res = await fetch(`/api/stripe/pay-link/finalize?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIntentId }),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || 'Failed to complete payment');
    return result.data?.amountPaid ?? chosenCents;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe) return;

    // Dynamic links (non-plan): validate the chosen amount client-side (server re-validates).
    if (dynamic && !usingPlan) {
      if (chosenCents <= 0) { setError('Please enter an amount to pay.'); return; }
      if (chosenCents > amount) { setError('Amount cannot exceed the balance due.'); return; }
    }

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
          // Server determines new-vs-saved from the PM's owner; this is only a hint.
          // When splitting into a plan the card MUST be saved for the future charges.
          saveCard: usingPlan ? true : (selected === 'new' ? saveCard : false),
          // Dynamic links (non-plan): the chosen amount (server caps it at the balance).
          ...(dynamic && !usingPlan ? { amount: chosenCents } : {}),
          // Plan: how many monthly payments. Server recomputes the split & schedules N-1.
          ...(usingPlan ? { planCount } : {}),
        }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Payment failed');

      // The actual amount charged (authoritative, from the server).
      let paidCents: number = result.data?.amountPaid ?? chosenCents;

      // 3DS path
      if (result.data?.requiresAction && result.data?.clientSecret) {
        const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
          result.data.clientSecret
        );
        if (confirmError) throw new Error(confirmError.message);
        if (paymentIntent?.status !== 'succeeded') {
          throw new Error('Your card could not be authorized. Please try another card.');
        }
        paidCents = await finalizeAfter3DS(result.data.paymentIntentId);
      }

      onPaid(paidCents, usingPlan ? planCount : undefined, usingPlan ? installments : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Free-amount editor: dynamic links only, and not when a plan is offered. */}
      {dynamic && !hasPlan && (
        <div>
          <label className="text-sm font-medium text-gray-700">Amount to pay</label>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
                setAmountInput(cleaned);
              }}
              className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="0.00"
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Up to {formatCurrency(amount, 'usd')} due.
          </p>
        </div>
      )}

      {/* Plan chooser: pay in full, or split into monthly payments. */}
      {hasPlan && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">How would you like to pay?</p>

          <label
            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              payChoice === 'full' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              name="paychoice"
              checked={payChoice === 'full'}
              onChange={() => setPayChoice('full')}
              className="w-4 h-4 text-indigo-600"
            />
            <span className="text-sm text-gray-800">
              Pay in full — <span className="font-semibold">{formatCurrency(amount, 'usd')}</span>
            </span>
          </label>

          <label
            className={`flex flex-col gap-2 p-3 rounded-xl border cursor-pointer transition-colors ${
              payChoice === 'split' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="paychoice"
                checked={payChoice === 'split'}
                onChange={() => setPayChoice('split')}
                className="w-4 h-4 text-indigo-600"
              />
              <CalendarClock className="w-4 h-4 text-indigo-500" />
              <span className="text-sm text-gray-800">Split into monthly payments</span>
            </div>

            {payChoice === 'split' && (
              <div className="pl-7 space-y-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Array.from({ length: planMax - 1 }, (_, i) => i + 2).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPlanCount(n)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                        planCount === n
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <span className="text-xs text-gray-500 ml-1">payments</span>
                </div>
                {installments.length > 0 && (
                  <p className="text-xs text-gray-600">
                    <span className="font-semibold">{formatCurrency(installments[0].amount, 'usd')}</span> today,
                    then{' '}
                    {installments.slice(1).map((p, idx) => (
                      <span key={p.index}>
                        {idx > 0 ? ', ' : ''}
                        {formatCurrency(p.amount, 'usd')} on{' '}
                        {new Date(p.date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    ))}
                    .
                  </p>
                )}
                <p className="text-[11px] text-gray-400">
                  Your card will be securely saved to complete the remaining payments.
                </p>
              </div>
            )}
          </label>
        </div>
      )}

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
          {/* Plan links save the card by necessity (already messaged above), so hide this. */}
          {!usingPlan && (
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={saveCard}
                onChange={(e) => setSaveCard(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded"
              />
              Save this card for future payments
            </label>
          )}
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
            <Lock className="w-4 h-4" />{' '}
            {usingPlan
              ? `Pay ${formatCurrency(chosenCents > 0 ? chosenCents : amount, 'usd')} now`
              : `Pay ${formatCurrency(chosenCents > 0 ? chosenCents : amount, 'usd')}`}
          </>
        )}
      </button>

      {usingPlan && installments.length > 1 && (
        <p className="text-center text-xs text-gray-500">
          then {installments.length - 1} more{' '}
          {installments.length - 1 === 1 ? 'payment' : 'payments'} of{' '}
          {formatCurrency(installments[1].amount, 'usd')}
          {installments.length > 2 ? '+' : ''}, billed monthly.
        </p>
      )}

      <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
        <Lock className="w-3 h-3" /> Secured by Stripe
      </p>
    </form>
  );
}

export function PayLinkForm(props: PayLinkFormProps) {
  const [paid, setPaid] = useState(false);
  const [paidCents, setPaidCents] = useState(0);
  const [futureInstallments, setFutureInstallments] = useState<Installment[]>([]);
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof getStripePromise> | null>(null);

  useEffect(() => {
    setStripePromise(getStripePromise(props.publishableKey));
  }, [props.publishableKey]);

  if (paid) {
    const remaining = futureInstallments.slice(1);
    return (
      <div className="text-center py-8">
        {/* Logo is already shown by the page above; don't duplicate it here. */}
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-9 h-9 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Payment Successful</h2>
        <p className="text-gray-600 text-sm">
          Thank you! Your payment of {formatCurrency(paidCents, 'usd')} has been received.
        </p>
        {remaining.length > 0 && (
          <div className="mt-4 text-left inline-block bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs font-medium text-gray-700 mb-2">
              Your remaining {remaining.length} {remaining.length === 1 ? 'payment is' : 'payments are'} scheduled:
            </p>
            <ul className="space-y-1">
              {remaining.map((p) => (
                <li key={p.index} className="text-xs text-gray-600 flex justify-between gap-6">
                  <span>{new Date(p.date * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                  <span className="font-medium">{formatCurrency(p.amount, 'usd')}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-gray-400 mt-2">Billed automatically to your saved card.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {props.customerName && (
        <p className="text-lg font-semibold text-gray-900 mb-4">
          Hi {props.customerName.split(' ')[0]},
        </p>
      )}
      <div className="mb-6">
        <p className="text-sm text-gray-500">
          {props.dynamic ? 'Balance due' : (props.description || 'Amount due')}
        </p>
        <p className="text-3xl font-bold text-gray-900">{formatCurrency(props.amount, 'usd')}</p>
        {props.dynamic && !props.plan && (
          <p className="text-xs text-gray-400 mt-1">You can pay the full balance or any part of it.</p>
        )}
      </div>
      {stripePromise && (
        <Elements stripe={stripePromise}>
          <InnerForm
            token={props.token}
            amount={props.amount}
            dynamic={props.dynamic}
            savedMethods={props.savedMethods}
            plan={props.plan}
            nowSec={props.nowSec}
            onPaid={(cents, _planCount, installments) => {
              setPaidCents(cents);
              if (installments) setFutureInstallments(installments);
              setPaid(true);
            }}
          />
        </Elements>
      )}
    </div>
  );
}
