'use client';

import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { Modal, ModalFooter, Button, Input, Textarea } from '@/components/ui';
import { CreditCard, DollarSign, FileText, AlertTriangle, Plus } from 'lucide-react';
import { InvoiceData } from '@/types';
import { formatCurrency } from '@/lib/utils';

// Sort priority: Failed (open with attempts) -> Open -> Draft
const getInvoiceSortPriority = (invoice: InvoiceData): number => {
  if (invoice.status === 'open' && invoice.amount_remaining > 0 && invoice.attempt_count > 0) return 0; // Failed
  if (invoice.status === 'open' && invoice.amount_remaining > 0) return 1; // Open with balance
  if (invoice.status === 'draft') return 2;
  return 3;
};

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface PayNowFormProps {
  customerId: string;
  invoices: InvoiceData[];
  invoiceUID: string;
  currency: string;
  onSuccess: () => void;
  onCancel: () => void;
}

function PayNowForm({ customerId, invoices, invoiceUID, currency, onSuccess, onCancel }: PayNowFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [applyToAll, setApplyToAll] = useState(true);
  const [saveCard, setSaveCard] = useState(false);
  const [showAllInvoices, setShowAllInvoices] = useState(false);

  // Filter invoices based on showAllInvoices toggle
  // By default, only show failed invoices (open with attempts > 0)
  // When showAllInvoices is true, also show draft invoices
  const payableInvoices = invoices
    .filter(inv => {
      // Always show failed invoices (open with payment attempts)
      if (inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0) return true;

      // Only show other invoices if showAllInvoices is enabled
      if (showAllInvoices) {
        if (inv.status === 'open' && inv.amount_remaining > 0) return true;
        if (inv.status === 'draft') {
          const metadataTotalPaid = inv.metadata?.totalPaid ? parseInt(inv.metadata.totalPaid) : 0;
          const effectiveRemaining = inv.amount_due - metadataTotalPaid;
          return effectiveRemaining > 0;
        }
      }
      return false;
    })
    .sort((a, b) => getInvoiceSortPriority(a) - getInvoiceSortPriority(b));

  // Check if invoice is a failed payment
  const isFailedInvoice = (inv: InvoiceData) =>
    inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0;

  // Calculate total selected amount (using effective remaining for draft invoices)
  const selectedTotal = selectedInvoiceIds.reduce((sum, id) => {
    const inv = payableInvoices.find(i => i.id === id);
    if (!inv) return sum;
    if (inv.status === 'draft') {
      const metadataTotalPaid = inv.metadata?.totalPaid ? parseInt(inv.metadata.totalPaid) : 0;
      return sum + Math.max(0, inv.amount_due - metadataTotalPaid);
    }
    return sum + (inv.amount_remaining || 0);
  }, 0);

  const handleInvoiceToggle = (invoiceId: string) => {
    if (applyToAll) {
      // When unchecking from "apply to all", deselect this invoice (select all others)
      setSelectedInvoiceIds(payableInvoices.filter(inv => inv.id !== invoiceId).map(inv => inv.id));
      setApplyToAll(false);
    } else {
      // Normal toggle behavior
      const isCurrentlySelected = selectedInvoiceIds.includes(invoiceId);
      const newSelected = isCurrentlySelected
        ? selectedInvoiceIds.filter(id => id !== invoiceId)
        : [...selectedInvoiceIds, invoiceId];

      setSelectedInvoiceIds(newSelected);

      // If all invoices are now selected, switch back to applyToAll mode
      // But only if there are actually invoices to select
      if (payableInvoices.length > 0 && newSelected.length === payableInvoices.length) {
        setApplyToAll(true);
        setSelectedInvoiceIds([]);
      }
    }
  };

  const handleSelectAll = () => {
    if (applyToAll) {
      setSelectedInvoiceIds([]);
      setApplyToAll(false);
    } else {
      setSelectedInvoiceIds(payableInvoices.map(inv => inv.id));
      setApplyToAll(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      return;
    }

    const payAmount = Math.round(parseFloat(amount) * 100);
    if (!amount || payAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!reason.trim()) {
      setError('Please enter a reason/note for this payment');
      return;
    }

    // Invoice selection is now optional - payment can be made as credit

    setLoading(true);
    setError('');

    try {
      // Create payment method (not saved to customer)
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

      // Call our API to process the payment and distribute to invoices
      const response = await fetch('/api/stripe/pay-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          paymentMethodId: paymentMethod.id,
          amount: payAmount,
          currency,
          reason,
          invoiceUID,
          selectedInvoiceIds: selectedInvoiceIds.length > 0 ? selectedInvoiceIds : null,
          applyToAll,
          saveCard,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Info */}
      <div className="bg-green-50 rounded-xl p-4 mb-6 border border-green-200">
        <div className="flex items-start gap-3">
          <DollarSign className="w-5 h-5 text-green-600 mt-0.5" />
          <div>
            <p className="font-medium text-green-800">Pay Now</p>
            <p className="text-sm text-green-600 mt-1">
              Make a one-time payment. Select invoices to apply payment to, or leave unselected to add as credit.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Amount */}
        <Input
          label="Payment Amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

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

          {/* Save Card Option */}
          <label className="flex items-center gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={saveCard}
              onChange={(e) => setSaveCard(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700 flex items-center gap-1">
              <Plus className="w-3 h-3" />
              Save this card for future payments
            </span>
          </label>
        </div>

        {/* Reason/Note */}
        <Textarea
          label="Payment Reason/Note (required)"
          placeholder="Enter a reason or note for this payment..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
        />

        {/* Invoice Selection - Always show */}
        <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Apply to Invoices
              </label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAllInvoices}
                    onChange={(e) => setShowAllInvoices(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-600">Show all</span>
                </label>
                {payableInvoices.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-xs text-indigo-600 hover:text-indigo-700"
                  >
                    {applyToAll || selectedInvoiceIds.length === payableInvoices.length ? 'Deselect All' : 'Select All'}
                  </button>
                )}
              </div>
            </div>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {payableInvoices.map((invoice) => {
                // Calculate effective remaining for draft invoices
                const metadataTotalPaid = invoice.metadata?.totalPaid ? parseInt(invoice.metadata.totalPaid) : 0;
                const effectiveRemaining = invoice.status === 'draft'
                  ? Math.max(0, invoice.amount_due - metadataTotalPaid)
                  : invoice.amount_remaining;
                const isFailed = isFailedInvoice(invoice);
                const isChecked = selectedInvoiceIds.includes(invoice.id) || applyToAll;
                return (
                  <div
                    key={invoice.id}
                    onClick={(e) => {
                      e.preventDefault();
                      handleInvoiceToggle(invoice.id);
                    }}
                    className={`flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer select-none ${isFailed ? 'bg-red-50' : ''}`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      isChecked
                        ? 'bg-indigo-600 border-indigo-600'
                        : 'border-gray-300 bg-white'
                    }`}>
                      {isChecked && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    {isFailed ? (
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                    ) : (
                      <FileText className="w-4 h-4 text-gray-400" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium truncate ${isFailed ? 'text-red-700' : 'text-gray-900'}`}>
                          {invoice.number || invoice.id.slice(0, 12)}
                        </p>
                        {isFailed && (
                          <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Failed</span>
                        )}
                        {invoice.status === 'draft' && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Draft</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        Remaining: {formatCurrency(effectiveRemaining, invoice.currency)}
                        {metadataTotalPaid > 0 && (
                          <span className="text-green-600 ml-1">(paid: {formatCurrency(metadataTotalPaid, invoice.currency)})</span>
                        )}
                        {isFailed && invoice.attempt_count > 0 && (
                          <span className="text-red-500 ml-1">({invoice.attempt_count} attempt{invoice.attempt_count !== 1 ? 's' : ''})</span>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            {(selectedInvoiceIds.length > 0 || applyToAll) && (
              <p className="text-xs text-gray-500 mt-2">
                Total to pay selected invoices: {formatCurrency(applyToAll ? payableInvoices.reduce((sum, inv) => {
                  const metaPaid = inv.metadata?.totalPaid ? parseInt(inv.metadata.totalPaid) : 0;
                  return sum + (inv.status === 'draft' ? Math.max(0, inv.amount_due - metaPaid) : inv.amount_remaining);
                }, 0) : selectedTotal, currency)}
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              {(selectedInvoiceIds.length > 0 || applyToAll)
                ? 'Payment will be applied sequentially to selected invoices. Excess will be added as credit. Draft invoices will be finalized before payment.'
                : 'No invoices selected - payment will be added as customer credit linked to this Payment UID.'}
            </p>
          </div>

        {payableInvoices.length === 0 && !showAllInvoices && (
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-sm text-gray-600">
              No failed invoices. Check "Show all" to see draft and open invoices.
            </p>
          </div>
        )}

        {payableInvoices.length === 0 && showAllInvoices && (
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <p className="text-sm text-blue-700">
              No open or draft invoices available. Payment will be added as customer credit linked to this Payment UID.
            </p>
          </div>
        )}

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
          {(selectedInvoiceIds.length > 0 || applyToAll) ? 'Pay Now' : 'Add Credit'}
        </Button>
      </ModalFooter>
    </form>
  );
}

interface PayNowModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  invoices: InvoiceData[];
  invoiceUID: string;
  currency: string;
  onSuccess: () => void;
}

export function PayNowModal({
  isOpen,
  onClose,
  customerId,
  invoices,
  invoiceUID,
  currency,
  onSuccess,
}: PayNowModalProps) {
  const handleSuccess = () => {
    onSuccess();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pay Now" size="lg">
      <Elements stripe={stripePromise}>
        <PayNowForm
          customerId={customerId}
          invoices={invoices}
          invoiceUID={invoiceUID}
          currency={currency}
          onSuccess={handleSuccess}
          onCancel={onClose}
        />
      </Elements>
    </Modal>
  );
}
