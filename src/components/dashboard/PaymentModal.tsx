'use client';

import { useState, useEffect, useMemo } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { InvoiceData, PaymentMethodData } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Modal, ModalFooter, Button, Input, Textarea } from '@/components/ui';
import { CreditCard, Plus, Check, FileText, AlertTriangle } from 'lucide-react';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice?: InvoiceData | null; // If provided, this is the primary invoice to pay
  invoices: InvoiceData[]; // All available invoices for additional selection
  paymentMethods: PaymentMethodData[];
  customerId: string;
  invoiceUID: string;
  currency: string;
  token?: string;
  onSuccess: () => void;
  onPaymentMethodAdded?: () => void;
}

// Sort priority: Failed (open with attempts) -> Open -> Draft
const getInvoiceSortPriority = (invoice: InvoiceData): number => {
  if (invoice.status === 'open' && invoice.amount_remaining > 0 && invoice.attempt_count > 0) return 0;
  if (invoice.status === 'open' && invoice.amount_remaining > 0) return 1;
  if (invoice.status === 'draft') return 2;
  return 3;
};

const isFailedInvoice = (inv: InvoiceData) =>
  inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0;

interface PaymentFormProps {
  invoice?: InvoiceData | null;
  invoices: InvoiceData[];
  paymentMethods: PaymentMethodData[];
  customerId: string;
  invoiceUID: string;
  currency: string;
  token?: string;
  onSuccess: () => void;
  onClose: () => void;
  onPaymentMethodAdded?: () => void;
}

function PaymentForm({
  invoice,
  invoices,
  paymentMethods,
  customerId,
  invoiceUID,
  currency,
  token,
  onSuccess,
  onClose,
  onPaymentMethodAdded,
}: PaymentFormProps) {
  // Helper to add token to API URLs
  const withToken = (url: string) => {
    if (!token) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  };
  const stripe = useStripe();
  const elements = useElements();

  const [amount, setAmount] = useState('');
  const [manualAmountEntered, setManualAmountEntered] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAddCard, setShowAddCard] = useState(false);
  const [saveCard, setSaveCard] = useState(false);

  // For invoice selection
  const [selectedAdditionalInvoices, setSelectedAdditionalInvoices] = useState<string[]>([]);
  const [showAllInvoices, setShowAllInvoices] = useState(false); // Default to hide drafts

  // Helper to get effective remaining amount for an invoice
  const getEffectiveRemaining = (inv: InvoiceData): number => {
    if (inv.status === 'draft') {
      const metadataTotalPaid = inv.metadata?.totalPaid ? parseInt(inv.metadata.totalPaid) : 0;
      return Math.max(0, inv.amount_due - metadataTotalPaid);
    }
    return inv.amount_remaining;
  };

  // Get failed invoices only (for calculating total failed amount)
  const failedInvoices = useMemo(() => {
    return invoices
      .filter(inv => {
        if (invoice && inv.id === invoice.id) return false;
        return inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0;
      })
      .sort((a, b) => getInvoiceSortPriority(a) - getInvoiceSortPriority(b));
  }, [invoices, invoice]);

  // Calculate total amount of all failed invoices
  const totalFailedAmount = useMemo(() => {
    return failedInvoices.reduce((sum, inv) => sum + inv.amount_remaining, 0);
  }, [failedInvoices]);

  // Get all payable invoices sorted by priority (failed first, then draft)
  // Draft invoices only shown if: showAllInvoices OR excess amount > totalFailedAmount
  const payableInvoices = useMemo(() => {
    const payAmountValue = amount ? Math.round(parseFloat(amount) * 100) : 0;
    const primaryAmount = invoice?.amount_remaining || 0;
    // For specific invoice payment: use excess amount; for general payment: use full amount
    const amountForDraftCheck = invoice ? Math.max(0, payAmountValue - primaryAmount) : payAmountValue;
    const shouldShowDrafts = showAllInvoices || amountForDraftCheck > totalFailedAmount;

    return invoices
      .filter(inv => {
        // Exclude the primary invoice if provided
        if (invoice && inv.id === invoice.id) return false;
        // Always include failed invoices (open with attempts > 0)
        if (inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0) return true;
        // Include draft invoices only if shouldShowDrafts
        if (inv.status === 'draft' && shouldShowDrafts) {
          const remaining = getEffectiveRemaining(inv);
          return remaining > 0;
        }
        return false;
      })
      .sort((a, b) => getInvoiceSortPriority(a) - getInvoiceSortPriority(b));
  }, [invoices, invoice, showAllInvoices, amount, totalFailedAmount]);

  // Calculate amounts
  const payAmount = amount ? Math.round(parseFloat(amount) * 100) : 0;
  const primaryInvoiceAmount = invoice?.amount_remaining || 0;
  const excessAmount = Math.max(0, payAmount - primaryInvoiceAmount);

  // Calculate total from selected invoices (for auto-sum mode)
  const selectedInvoicesTotal = useMemo(() => {
    return selectedAdditionalInvoices.reduce((sum, invId) => {
      const inv = payableInvoices.find(i => i.id === invId);
      if (inv) {
        return sum + getEffectiveRemaining(inv);
      }
      return sum;
    }, 0);
  }, [selectedAdditionalInvoices, payableInvoices]);

  // Auto-select invoices based on entered amount (when amount is manually entered)
  // For specific invoice payment: use excess amount; for general payment: use full amount
  const autoSelectedInvoices = useMemo(() => {
    // For specific invoice: only auto-select if there's excess
    // For general payment: auto-select based on entered amount
    const availableAmount = invoice ? excessAmount : payAmount;
    if (availableAmount <= 0) return [];

    let remaining = availableAmount;
    const selected: string[] = [];

    for (const inv of payableInvoices) {
      if (remaining <= 0) break;
      const invAmount = getEffectiveRemaining(inv);
      if (invAmount > 0) {
        selected.push(inv.id);
        remaining -= invAmount;
      }
    }

    return selected;
  }, [invoice, excessAmount, payAmount, payableInvoices]);

  // Calculate how much of the payment applies to each invoice (for display)
  const invoicePaymentBreakdown = useMemo(() => {
    const breakdown: Record<string, { willPay: number; remaining: number }> = {};
    // For specific invoice: use excess; for general: use full amount
    const availableAmount = invoice ? excessAmount : payAmount;
    let remaining = availableAmount;

    // Always use selectedAdditionalInvoices (user can modify after auto-selection)
    for (const invId of selectedAdditionalInvoices) {
      const inv = payableInvoices.find(i => i.id === invId);
      if (inv && remaining > 0) {
        const invAmount = getEffectiveRemaining(inv);
        const willPay = Math.min(remaining, invAmount);
        breakdown[invId] = {
          willPay,
          remaining: Math.max(0, invAmount - willPay),
        };
        remaining -= willPay;
      }
    }

    return breakdown;
  }, [invoice, excessAmount, payAmount, selectedAdditionalInvoices, payableInvoices]);

  // Reset form when modal opens or invoice changes
  useEffect(() => {
    if (invoice) {
      setAmount((invoice.amount_remaining / 100).toFixed(2));
      setManualAmountEntered(true);
      const invoicePm = invoice.default_payment_method
        ? paymentMethods.find(pm => pm.id === invoice.default_payment_method)
        : null;
      const defaultPm = paymentMethods.find(pm => pm.isDefault);
      setPaymentMethodId(invoicePm?.id || defaultPm?.id || paymentMethods[0]?.id || '');
    } else {
      setAmount('');
      setManualAmountEntered(false);
      const defaultPm = paymentMethods.find(pm => pm.isDefault);
      setPaymentMethodId(defaultPm?.id || paymentMethods[0]?.id || '');
    }
    setNote('');
    setError('');
    setSelectedAdditionalInvoices([]);
    setShowAddCard(false);
    setSaveCard(false);
    setShowAllInvoices(false);
  }, [invoice, paymentMethods]);

  // Auto-update amount when invoices are selected (and no manual amount)
  useEffect(() => {
    if (!manualAmountEntered && selectedAdditionalInvoices.length > 0) {
      setAmount((selectedInvoicesTotal / 100).toFixed(2));
    } else if (!manualAmountEntered && selectedAdditionalInvoices.length === 0 && !invoice) {
      setAmount('');
    }
  }, [selectedAdditionalInvoices, selectedInvoicesTotal, manualAmountEntered, invoice]);

  const handleAmountChange = (value: string) => {
    setAmount(value);
    // Mark as manual entry if user types something
    if (value && parseFloat(value) > 0) {
      setManualAmountEntered(true);
      // Auto-select invoices based on entered amount, but allow user to modify
      // Calculate which invoices would be auto-selected for this amount
      const payAmountValue = Math.round(parseFloat(value) * 100);
      const availableAmount = invoice ? Math.max(0, payAmountValue - (invoice.amount_remaining || 0)) : payAmountValue;

      if (availableAmount > 0) {
        let remaining = availableAmount;
        const autoSelected: string[] = [];
        for (const inv of payableInvoices) {
          if (remaining <= 0) break;
          const invAmount = getEffectiveRemaining(inv);
          if (invAmount > 0) {
            autoSelected.push(inv.id);
            remaining -= invAmount;
          }
        }
        setSelectedAdditionalInvoices(autoSelected);
      } else {
        setSelectedAdditionalInvoices([]);
      }
    } else if (!value) {
      setManualAmountEntered(false);
      setSelectedAdditionalInvoices([]);
    }
  };

  const handleAdditionalInvoiceToggle = (invoiceId: string) => {
    // Allow toggling invoices regardless of whether amount was manually entered
    setSelectedAdditionalInvoices(prev =>
      prev.includes(invoiceId)
        ? prev.filter(id => id !== invoiceId)
        : [...prev, invoiceId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (payAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    // If no primary invoice and no invoices selected, payment will auto-apply to failed then draft invoices

    // Need payment method (either selected or adding new)
    if (!showAddCard && !paymentMethodId) {
      setError('Please select a payment method or add a new card');
      return;
    }

    // Verify token is available for API authentication
    if (!token) {
      setError('Session expired. Please refresh the page.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let finalPaymentMethodId = paymentMethodId;

      // If adding a new card
      if (showAddCard) {
        if (!stripe || !elements) {
          throw new Error('Stripe not loaded');
        }

        const cardElement = elements.getElement(CardElement);
        if (!cardElement) {
          throw new Error('Card element not found');
        }

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

        // If saving card, attach to customer
        if (saveCard) {
          const response = await fetch(withToken('/api/stripe/payment-methods'), {
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
          onPaymentMethodAdded?.();
        }

        finalPaymentMethodId = paymentMethod.id;
      }

      // Build the list of invoices to pay
      const invoicesToPay: string[] = [];
      if (invoice) {
        invoicesToPay.push(invoice.id);
      }
      // Always use selectedAdditionalInvoices (user can modify after auto-selection)
      invoicesToPay.push(...selectedAdditionalInvoices);

      // Call our unified payment API
      // Apply to all only if no specific invoices are selected
      const shouldApplyToAll = !invoice && invoicesToPay.length === 0;

      const response = await fetch(withToken('/api/stripe/pay-now'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          paymentMethodId: finalPaymentMethodId,
          amount: payAmount,
          currency,
          reason: note,
          invoiceUID,
          selectedInvoiceIds: invoicesToPay,
          applyToAll: shouldApplyToAll,
          saveCard: showAddCard && saveCard,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process payment');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setAmount('');
    setManualAmountEntered(false);
    setPaymentMethodId('');
    setNote('');
    setError('');
    setShowAddCard(false);
    setSaveCard(false);
    setSelectedAdditionalInvoices([]);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Primary Invoice Summary (if paying specific invoice) */}
      {invoice && (
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Invoice</span>
            <span className="font-mono text-sm">{invoice.number || invoice.id.slice(0, 12)}</span>
          </div>
          <div className="flex items-center justify-between mb-3">
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
      )}

      <div className="space-y-4">
        {/* Payment Amount */}
        <Input
          label="Payment Amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder={invoice ? (invoice.amount_remaining / 100).toFixed(2) : '0.00'}
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          hint={manualAmountEntered
            ? 'Amount will be applied to invoices in order (failed first, then draft)'
            : 'Select invoices below or enter amount manually'}
        />

        {/* Payment Method Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Payment Method
          </label>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
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
          <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
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
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
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

        {/* Note */}
        <Textarea
          label="Payment Note (optional)"
          placeholder="Enter a note for this payment..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />

        {/* Invoice Selection - Show in Make Payment mode OR when excess amount on specific invoice */}
        {(!invoice || excessAmount > 0) && (
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-800">
                  {invoice
                    ? 'Additional invoices to pay with excess:'
                    : manualAmountEntered
                      ? 'Invoices to be paid:'
                      : 'Select invoices to pay:'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {selectedAdditionalInvoices.length > 0 && !manualAmountEntered && (
                  <span className="text-xs font-medium text-indigo-600">
                    Total: {formatCurrency(selectedInvoicesTotal, currency)}
                  </span>
                )}
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAllInvoices}
                    onChange={(e) => setShowAllInvoices(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-gray-600">Show all</span>
                </label>
              </div>
            </div>
            {payableInvoices.length > 0 ? (
              <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {payableInvoices.map((inv) => {
                  const effectiveRemaining = getEffectiveRemaining(inv);
                  const isFailed = isFailedInvoice(inv);
                  const breakdown = invoicePaymentBreakdown[inv.id];
                  const isSelected = selectedAdditionalInvoices.includes(inv.id);
                  const willBeFullyPaid = breakdown && breakdown.remaining === 0;

                  return (
                    <label
                      key={inv.id}
                      className={`flex items-center gap-2 p-2 cursor-pointer transition-colors ${
                        isSelected
                          ? willBeFullyPaid
                            ? 'bg-green-50'
                            : 'bg-amber-50'
                          : isFailed
                            ? 'bg-red-50/50 hover:bg-red-50'
                            : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleAdditionalInvoiceToggle(inv.id)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                      />
                      {isFailed ? (
                        <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
                      ) : (
                        <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className={`text-sm truncate ${isFailed ? 'text-red-700' : 'text-gray-900'}`}>
                          {inv.number || inv.id.slice(0, 8)}
                        </span>
                        {isFailed && <span className="text-[10px] bg-red-100 text-red-600 px-1 rounded flex-shrink-0">Failed</span>}
                        {inv.status === 'draft' && <span className="text-[10px] bg-gray-100 text-gray-500 px-1 rounded flex-shrink-0">Draft</span>}
                      </div>
                      {/* Amount display with breakdown */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {isSelected && breakdown ? (
                          <>
                            <span className="text-xs text-gray-400 line-through">
                              {formatCurrency(effectiveRemaining, inv.currency)}
                            </span>
                            <span className={`text-xs font-medium ${willBeFullyPaid ? 'text-green-600' : 'text-amber-600'}`}>
                              {willBeFullyPaid ? '$0.00' : formatCurrency(breakdown.remaining, inv.currency)}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-gray-500">
                            {formatCurrency(effectiveRemaining, inv.currency)}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No invoices available to pay.</p>
            )}
            {/* Excess credit info */}
            {(() => {
              // Calculate available amount for additional invoices
              const availableForAdditional = invoice ? excessAmount : payAmount;
              if (availableForAdditional <= 0) return null;

              return null;
            })()}
          </div>
        )}


        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={loading}
          disabled={!stripe && showAddCard}
        >
          <CreditCard className="w-4 h-4" />
          Pay {payAmount > 0 ? formatCurrency(payAmount, currency) : ''}
        </Button>
      </ModalFooter>
    </form>
  );
}

export function PaymentModal({
  isOpen,
  onClose,
  invoice,
  invoices,
  paymentMethods,
  customerId,
  invoiceUID,
  currency,
  token,
  onSuccess,
  onPaymentMethodAdded,
}: PaymentModalProps) {
  const title = invoice
    ? `Pay Invoice ${invoice.number || invoice.id.slice(0, 12)}`
    : 'Make Payment';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
      <Elements stripe={stripePromise}>
        <PaymentForm
          invoice={invoice}
          invoices={invoices}
          paymentMethods={paymentMethods}
          customerId={customerId}
          invoiceUID={invoiceUID}
          currency={currency}
          token={token}
          onSuccess={onSuccess}
          onClose={onClose}
          onPaymentMethodAdded={onPaymentMethodAdded}
        />
      </Elements>
    </Modal>
  );
}
