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
import { formatCurrency, formatDate } from '@/lib/utils';
import { Modal, ModalFooter, Button, Input, Textarea } from '@/components/ui';
import { CreditCard, Plus, Check, FileText, AlertTriangle, CircleDollarSign, Calendar, Clock } from 'lucide-react';

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
  accountId?: string;
  onSuccess: () => void;
  onPaymentMethodAdded?: () => void;
  outstandingAmount?: number; // Outstanding amount (in cents) from token total minus paid/scheduled/failed
}

// Sort priority: Failed (open with attempts) -> Open -> Draft
const getInvoiceSortPriority = (invoice: InvoiceData): number => {
  if (invoice.status === 'open' && invoice.amount_remaining > 0 && invoice.attempt_count > 0) return 0;
  if (invoice.status === 'open' && invoice.amount_remaining > 0) return 1;
  if (invoice.status === 'draft') return 2;
  return 3;
};

// Sort invoices by priority first, then by date (closest to pay first = ascending)
const sortInvoicesByPriorityAndDate = (a: InvoiceData, b: InvoiceData): number => {
  const priorityDiff = getInvoiceSortPriority(a) - getInvoiceSortPriority(b);
  if (priorityDiff !== 0) return priorityDiff;
  // Within same priority, sort by date ascending (closest dates first)
  const dateA = getInvoiceDate(a) || 0;
  const dateB = getInvoiceDate(b) || 0;
  return dateA - dateB;
};

const isFailedInvoice = (inv: InvoiceData) =>
  inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0;

// Get the correct finalize/scheduled date for an invoice
// Priority: scheduledFinalizeAt → effective_at (finalized date) → automatically_finalizes_at → due_date → created
const getInvoiceDate = (inv: InvoiceData): number | null => {
  // Check scheduledFinalizeAt first - this is the original scheduled date preserved in metadata
  if (inv.metadata?.scheduledFinalizeAt) return parseInt(inv.metadata.scheduledFinalizeAt, 10);
  // For finalized (open/paid) invoices, effective_at is when it was finalized
  if (inv.effective_at) return inv.effective_at;
  // For drafts, check automatically_finalizes_at
  if (inv.automatically_finalizes_at) return inv.automatically_finalizes_at;
  // Then check due_date
  if (inv.due_date) return inv.due_date;
  // Fallback to created
  return inv.created;
};

interface PaymentFormProps {
  invoice?: InvoiceData | null;
  invoices: InvoiceData[];
  paymentMethods: PaymentMethodData[];
  customerId: string;
  invoiceUID: string;
  currency: string;
  token?: string;
  accountId?: string;
  onSuccess: () => void;
  onClose: () => void;
  onPaymentMethodAdded?: () => void;
  onFormSuccess: () => void;
  onFormError: (error: string) => void;
  isOpen: boolean;
  outstandingAmount?: number;
}

function PaymentForm({
  invoice,
  invoices,
  paymentMethods,
  customerId,
  invoiceUID,
  currency,
  token,
  accountId,
  onSuccess,
  onClose,
  onPaymentMethodAdded,
  onFormSuccess,
  onFormError,
  isOpen,
  outstandingAmount = 0,
}: PaymentFormProps) {
  // Helper to add token and accountId to API URLs
  const withToken = (url: string) => {
    let result = url;
    if (token) {
      const separator = result.includes('?') ? '&' : '?';
      result = `${result}${separator}token=${encodeURIComponent(token)}`;
    }
    if (accountId) {
      const separator = result.includes('?') ? '&' : '?';
      result = `${result}${separator}accountId=${encodeURIComponent(accountId)}`;
    }
    return result;
  };
  const stripe = useStripe();
  const elements = useElements();

  // Initialize amount with invoice amount if provided
  const [amount, setAmount] = useState(() =>
    invoice ? (invoice.amount_remaining / 100).toFixed(2) : ''
  );
  // amountLockedByInput: true when user typed amount first (amount is fixed, invoices are read-only when budget exhausted)
  // false when user is selecting invoices first (amount follows selection)
  const [amountLockedByInput, setAmountLockedByInput] = useState(() => !!invoice);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [saveCard, setSaveCard] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false); // Toggle between pay now and schedule
  const [scheduledDate, setScheduledDate] = useState(''); // Date string in MM/DD/YYYY format

  // For invoice selection - now includes the primary invoice if provided
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>(() =>
    invoice ? [invoice.id] : []
  );
  const [showAllInvoices, setShowAllInvoices] = useState(false); // Default to hide drafts
  const [outstandingSelected, setOutstandingSelected] = useState(false); // Track if outstanding amount is selected

  // Helper to get effective remaining amount for an invoice
  // For draft invoices, amount_due might be 0 - use subtotal/total as fallback
  const getEffectiveRemaining = (inv: InvoiceData): number => {
    if (inv.status === 'draft') {
      // Get the base amount - use fallback if amount_due is 0
      let baseAmount = inv.amount_due;
      if (baseAmount === 0) {
        if (inv.subtotal && inv.subtotal > 0) {
          baseAmount = inv.subtotal;
        } else if (inv.total && inv.total > 0) {
          baseAmount = inv.total;
        } else if (inv.lines && inv.lines.length > 0) {
          baseAmount = inv.lines.reduce((sum, line) => sum + line.amount, 0);
        }
      }
      const metadataTotalPaid = inv.metadata?.totalPaid ? parseInt(inv.metadata.totalPaid) : 0;
      return Math.max(0, baseAmount - metadataTotalPaid);
    }
    return inv.amount_remaining;
  };

  // Get failed invoices only (for calculating total failed amount)
  // Now includes the primary invoice if it's a failed invoice
  const failedInvoices = useMemo(() => {
    return invoices
      .filter(inv => {
        return inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0;
      })
      .sort(sortInvoicesByPriorityAndDate);
  }, [invoices]);

  // Calculate total amount of all failed payments
  const totalFailedAmount = useMemo(() => {
    return failedInvoices.reduce((sum, inv) => sum + inv.amount_remaining, 0);
  }, [failedInvoices]);

  // Get all payable invoices sorted by priority (failed first, then draft)
  // Draft invoices shown if: showAllInvoices OR amount > totalFailedAmount OR no failed invoices exist
  // Now includes the primary invoice in the list (no longer excluded)
  const payableInvoices = useMemo(() => {
    const payAmountValue = amount ? Math.round(parseFloat(amount) * 100) : 0;
    const noFailedInvoices = failedInvoices.length === 0;
    const shouldShowDrafts = showAllInvoices || payAmountValue > totalFailedAmount || noFailedInvoices;

    return invoices
      .filter(inv => {
        // Always include failed invoices (open with attempts > 0)
        if (inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0) return true;
        // Include draft invoices only if shouldShowDrafts
        if (inv.status === 'draft' && shouldShowDrafts) {
          const remaining = getEffectiveRemaining(inv);
          return remaining > 0;
        }
        return false;
      })
      .sort(sortInvoicesByPriorityAndDate);
  }, [invoices, showAllInvoices, amount, totalFailedAmount, failedInvoices.length]);

  // Calculate amounts
  const payAmount = amount ? Math.round(parseFloat(amount) * 100) : 0;

  // Calculate total from selected invoices (for auto-sum mode)
  // Include outstanding amount if selected
  const selectedInvoicesTotal = useMemo(() => {
    let total = selectedInvoices.reduce((sum, invId) => {
      const inv = payableInvoices.find(i => i.id === invId);
      if (inv) {
        return sum + getEffectiveRemaining(inv);
      }
      return sum;
    }, 0);
    // Add outstanding amount if selected
    if (outstandingSelected && outstandingAmount > 0) {
      total += outstandingAmount;
    }
    return total;
  }, [selectedInvoices, payableInvoices, outstandingSelected, outstandingAmount]);

  // Calculate how much of the payment applies to each invoice AND outstanding (for display)
  // Order: Failed invoices -> Outstanding -> Draft invoices
  const invoicePaymentBreakdown = useMemo(() => {
    const breakdown: Record<string, { willPay: number; remaining: number }> = {};
    let remaining = payAmount;

    // First: Apply to selected FAILED invoices
    for (const invId of selectedInvoices) {
      const inv = payableInvoices.find(i => i.id === invId);
      if (inv && isFailedInvoice(inv) && remaining > 0) {
        const invAmount = getEffectiveRemaining(inv);
        const willPay = Math.min(remaining, invAmount);
        breakdown[invId] = {
          willPay,
          remaining: Math.max(0, invAmount - willPay),
        };
        remaining -= willPay;
      }
    }

    // Second: Apply to Outstanding if selected
    if (outstandingSelected && outstandingAmount > 0 && remaining > 0) {
      const willPay = Math.min(remaining, outstandingAmount);
      breakdown['__outstanding__'] = {
        willPay,
        remaining: Math.max(0, outstandingAmount - willPay),
      };
      remaining -= willPay;
    }

    // Third: Apply to selected DRAFT invoices
    for (const invId of selectedInvoices) {
      const inv = payableInvoices.find(i => i.id === invId);
      if (inv && inv.status === 'draft' && remaining > 0) {
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
  }, [payAmount, selectedInvoices, payableInvoices, outstandingSelected, outstandingAmount]);

  // Get the outstanding breakdown for display
  const outstandingBreakdown = invoicePaymentBreakdown['__outstanding__'];

  // Calculate remaining credit (amount not applied to any invoice or outstanding)
  const remainingCredit = useMemo(() => {
    let totalApplied = 0;

    // Add all amounts applied to selected invoices and outstanding
    Object.values(invoicePaymentBreakdown).forEach(breakdown => {
      totalApplied += breakdown.willPay;
    });

    return Math.max(0, payAmount - totalApplied);
  }, [payAmount, invoicePaymentBreakdown]);

  // Reset form when modal opens or invoice changes
  useEffect(() => {
    if (!isOpen) return; // Only run when modal is open

    if (invoice) {
      // Pre-select the specific invoice and set its amount
      const invoiceAmount = (invoice.amount_remaining / 100).toFixed(2);
      setAmount(invoiceAmount);
      setAmountLockedByInput(false); // Don't lock - let amount follow checkbox selection
      setSelectedInvoices([invoice.id]);
      const invoicePm = invoice.default_payment_method
        ? paymentMethods.find(pm => pm.id === invoice.default_payment_method)
        : null;
      const defaultPm = paymentMethods.find(pm => pm.isDefault);
      setPaymentMethodId(invoicePm?.id || defaultPm?.id || paymentMethods[0]?.id || '');
    } else {
      setAmount('');
      setAmountLockedByInput(false);
      setSelectedInvoices([]);
      const defaultPm = paymentMethods.find(pm => pm.isDefault);
      setPaymentMethodId(defaultPm?.id || paymentMethods[0]?.id || '');
    }
    setNote('');
    setShowAddCard(false);
    setSaveCard(false);
    setShowAllInvoices(false);
    setOutstandingSelected(false);
  }, [isOpen, invoice, paymentMethods]);

  // Auto-update amount when invoices are selected (only when amount is NOT locked by manual input)
  useEffect(() => {
    if (!amountLockedByInput && (selectedInvoices.length > 0 || outstandingSelected)) {
      setAmount((selectedInvoicesTotal / 100).toFixed(2));
    } else if (!amountLockedByInput && selectedInvoices.length === 0 && !outstandingSelected) {
      setAmount('');
    }
  }, [selectedInvoices, selectedInvoicesTotal, amountLockedByInput, outstandingSelected]);

  const handleAmountChange = (value: string) => {
    setAmount(value);
    if (value && parseFloat(value) > 0) {
      // Lock amount - user typed it manually, so amount is fixed
      setAmountLockedByInput(true);
      // Auto-select failed invoices and outstanding based on amount
      const payAmountValue = Math.round(parseFloat(value) * 100);

      if (payAmountValue > 0) {
        let remaining = payAmountValue;
        const autoSelected: string[] = [];

        // First: auto-select failed invoices
        for (const inv of payableInvoices) {
          if (remaining <= 0) break;
          // Only auto-select failed invoices
          if (inv.status === 'open' && inv.attempt_count > 0) {
            const invAmount = getEffectiveRemaining(inv);
            if (invAmount > 0) {
              autoSelected.push(inv.id);
              remaining -= invAmount;
            }
          }
        }
        setSelectedInvoices(autoSelected);

        // Second: auto-select outstanding if there's remaining amount
        if (remaining > 0 && outstandingAmount > 0) {
          setOutstandingSelected(true);
        } else {
          setOutstandingSelected(false);
        }
      } else {
        setSelectedInvoices([]);
        setOutstandingSelected(false);
      }
    } else if (!value) {
      // Clear amount - unlock so user can select invoices
      setAmountLockedByInput(false);
      setSelectedInvoices([]);
      setOutstandingSelected(false);
    }
  };

  const handleInvoiceToggle = (invoiceId: string) => {
    setSelectedInvoices(prev => {
      const newSelected = prev.includes(invoiceId)
        ? prev.filter(id => id !== invoiceId)
        : [...prev, invoiceId];

      // Only update amount if NOT locked by manual input
      if (!amountLockedByInput) {
        // Calculate new total and update amount based on selection
        const newTotal = newSelected.reduce((sum, invId) => {
          const inv = payableInvoices.find(i => i.id === invId);
          if (inv) {
            return sum + getEffectiveRemaining(inv);
          }
          return sum;
        }, 0);

        if (newSelected.length > 0) {
          setAmount((newTotal / 100).toFixed(2));
        } else {
          setAmount('');
        }
      }
      // If amount is locked, don't change it - just toggle selection

      return newSelected;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (payAmount <= 0) {
      onFormError('Please enter a valid amount');
      return;
    }

    // Verify token is available for API authentication
    if (!token) {
      onFormError('Session expired. Please refresh the page.');
      return;
    }

    // SCHEDULE MODE: Create a draft invoice instead of paying
    if (scheduleMode) {
      if (!scheduledDate) {
        onFormError('Please select a date for the scheduled payment');
        return;
      }

      // Require payment method selection for scheduling
      if (!paymentMethodId) {
        onFormError('Please select a payment method for the scheduled payment');
        return;
      }

      setLoading(true);

      try {
        // Convert date string (YYYY-MM-DD from date input) to Unix timestamp at 12:00 noon
        const dateObj = new Date(scheduledDate + 'T12:00:00');
        const scheduledTimestamp = Math.floor(dateObj.getTime() / 1000);

        // If we have an original invoice (e.g., from failed payment), include it to be voided
        // and copy its metadata to the new draft
        const sourceInvoice = invoice && isFailedInvoice(invoice) ? {
          id: invoice.id,
          metadata: invoice.metadata,
        } : undefined;

        const response = await fetch(withToken('/api/stripe/invoices/create-draft'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId,
            amount: payAmount,
            currency,
            description: note || 'Scheduled Payment',
            invoiceUID,
            scheduledDate: scheduledTimestamp,
            accountId,
            paymentMethodId,
            sourceInvoice, // Include source invoice to void and copy metadata
          }),
        });

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error);
        }

        onSuccess();
        onFormSuccess();
      } catch (err) {
        onFormError(err instanceof Error ? err.message : 'Failed to create scheduled payment');
      } finally {
        setLoading(false);
      }
      return;
    }

    // PAY NOW MODE: Process payment immediately
    // Need payment method (either selected or adding new)
    if (!showAddCard && !paymentMethodId) {
      onFormError('Please select a payment method or add a new card');
      return;
    }

    setLoading(true);

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

      // Build the list of invoices to pay - now unified, using selectedInvoices directly
      const invoicesToPay: string[] = [...selectedInvoices];

      // Call our unified payment API
      // Apply to all only if no invoices are selected
      const shouldApplyToAll = invoicesToPay.length === 0;

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
          accountId,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      onSuccess();
      onFormSuccess();
    } catch (err) {
      onFormError(err instanceof Error ? err.message : 'Failed to process payment');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setAmount('');
    setAmountLockedByInput(false);
    setPaymentMethodId('');
    setNote('');
    setShowAddCard(false);
    setSaveCard(false);
    setScheduleMode(false);
    setScheduledDate('');
    setSelectedInvoices([]);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        {/* Payment Amount */}
        <Input
          label="Payment Amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          hint={amountLockedByInput
            ? 'Amount is fixed. Select/deselect payments below.'
            : 'Select payments below or enter amount manually'}
        />

        {/* Invoice Selection - Always show the list of payable invoices */}
        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-gray-600" />
              <span className="text-sm font-medium text-gray-800">
                {amountLockedByInput ? 'Payments to be made:' : 'Select payments:'}
              </span>
              {remainingCredit > 0 && (
                <span className="text-indigo-700 text-xs font-medium">
                  +{formatCurrency(remainingCredit, currency)} credit
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {selectedInvoices.length > 0 && !amountLockedByInput && (
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
          {payableInvoices.length > 0 || outstandingAmount > 0 ? (
            <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {/* Failed invoices first */}
              {payableInvoices.filter(inv => isFailedInvoice(inv)).map((inv) => {
                const effectiveRemaining = getEffectiveRemaining(inv);
                const breakdown = invoicePaymentBreakdown[inv.id];
                const isSelected = selectedInvoices.includes(inv.id);
                const willBeFullyPaid = breakdown && breakdown.remaining === 0;
                const isDisabled = amountLockedByInput && !isSelected && remainingCredit <= 0;

                return (
                  <label
                    key={inv.id}
                    className={`flex items-center gap-2 p-2 transition-colors ${isDisabled
                        ? 'cursor-not-allowed opacity-50 bg-gray-100'
                        : isSelected
                          ? willBeFullyPaid
                            ? 'bg-green-50 cursor-pointer'
                            : 'bg-amber-50 cursor-pointer'
                          : 'bg-red-50/50 hover:bg-red-50 cursor-pointer'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => !isDisabled && handleInvoiceToggle(inv.id)}
                      disabled={isDisabled}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 disabled:opacity-50"
                    />
                    <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className={`text-sm truncate text-red-700`}>
                        {formatDate(getInvoiceDate(inv))}
                      </span>
                      <span className="text-[10px] bg-red-100 text-red-600 px-1 rounded flex-shrink-0">Failed</span>
                    </div>
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
                        <span className={`text-xs ${isDisabled ? 'text-gray-400' : 'text-gray-500'}`}>
                          {formatCurrency(effectiveRemaining, inv.currency)}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}

              {/* Outstanding amount - after failed, before drafts */}
              {outstandingAmount > 0 && (() => {
                const willBeFullyPaid = outstandingBreakdown && outstandingBreakdown.remaining === 0;
                return (
                  <label
                    className={`flex items-center gap-2 p-2 transition-colors ${outstandingSelected
                        ? willBeFullyPaid
                          ? 'bg-green-50 cursor-pointer'
                          : 'bg-amber-50 cursor-pointer'
                        : 'bg-amber-50/30 hover:bg-amber-50 cursor-pointer'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={outstandingSelected}
                      onChange={() => setOutstandingSelected(!outstandingSelected)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                    />
                    <CircleDollarSign className="w-3 h-3 text-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-sm text-amber-700">Outstanding Balance</span>
                      <span className="text-[10px] bg-amber-100 text-amber-600 px-1 rounded flex-shrink-0">Balance</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {outstandingSelected && outstandingBreakdown ? (
                        <>
                          <span className="text-xs text-gray-400 line-through">
                            {formatCurrency(outstandingAmount, currency)}
                          </span>
                          <span className={`text-xs font-medium ${willBeFullyPaid ? 'text-green-600' : 'text-amber-600'}`}>
                            {willBeFullyPaid ? '$0.00' : formatCurrency(outstandingBreakdown.remaining, currency)}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-gray-500">
                          {formatCurrency(outstandingAmount, currency)}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })()}

              {/* Draft/Scheduled invoices */}
              {payableInvoices.filter(inv => inv.status === 'draft').map((inv) => {
                const effectiveRemaining = getEffectiveRemaining(inv);
                const breakdown = invoicePaymentBreakdown[inv.id];
                const isSelected = selectedInvoices.includes(inv.id);
                const willBeFullyPaid = breakdown && breakdown.remaining === 0;
                const isDisabled = amountLockedByInput && !isSelected && remainingCredit <= 0;

                return (
                  <label
                    key={inv.id}
                    className={`flex items-center gap-2 p-2 transition-colors ${isDisabled
                        ? 'cursor-not-allowed opacity-50 bg-gray-100'
                        : isSelected
                          ? willBeFullyPaid
                            ? 'bg-green-50 cursor-pointer'
                            : 'bg-amber-50 cursor-pointer'
                          : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => !isDisabled && handleInvoiceToggle(inv.id)}
                      disabled={isDisabled}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 disabled:opacity-50"
                    />
                    <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className={`text-sm truncate ${isDisabled ? 'text-gray-400' : 'text-gray-900'}`}>
                        {formatDate(getInvoiceDate(inv))}
                      </span>
                      <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1 rounded flex-shrink-0">Scheduled</span>
                    </div>
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
                        <span className={`text-xs ${isDisabled ? 'text-gray-400' : 'text-gray-500'}`}>
                          {formatCurrency(effectiveRemaining, inv.currency)}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-500">No payments available.</p>
          )}
        </div>

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
                className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${!showAddCard && paymentMethodId === pm.id
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
                {!showAddCard && paymentMethodId === pm.id && (
                  <Check className="w-4 h-4 text-indigo-600" />
                )}
              </label>
            ))}

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

        {/* Schedule Mode Toggle */}
        <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={scheduleMode}
              onChange={(e) => {
                setScheduleMode(e.target.checked);
                if (!e.target.checked) {
                  setScheduledDate('');
                }
              }}
              className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
            />
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">Schedule as future payment instead of paying now</span>
            </div>
          </label>

          {/* Date Picker - shown when schedule mode is enabled */}
          {scheduleMode && (
            <div className="mt-3 pl-7">
              <label className="block text-sm font-medium text-amber-700 mb-1">
                Schedule Date
              </label>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm bg-white"
              />
              <p className="text-xs text-amber-600 mt-1">
                A scheduled payment will be created and charged on this date
              </p>
            </div>
          )}
        </div>
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        {scheduleMode ? (
          <Button
            type="submit"
            loading={loading}
            disabled={!scheduledDate || payAmount <= 0}
            className="bg-amber-600 hover:bg-amber-700"
          >
            <Clock className="w-4 h-4" />
            Schedule {payAmount > 0 ? formatCurrency(payAmount, currency) : ''}
          </Button>
        ) : (
          <Button
            type="submit"
            loading={loading}
            disabled={!stripe && showAddCard}
          >
            <CreditCard className="w-4 h-4" />
            Pay {payAmount > 0 ? formatCurrency(payAmount, currency) : ''}
          </Button>
        )}
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
  accountId,
  onSuccess,
  onPaymentMethodAdded,
  outstandingAmount = 0,
}: PaymentModalProps) {
  const [result, setResult] = useState<{ type: 'success' | 'error'; message?: string } | null>(null);

  // Reset result when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setResult(null);
    }
  }, [isOpen]);

  const handleClose = () => {
    setResult(null);
    onClose();
  };

  const handleFormSuccess = () => {
    setResult({ type: 'success' });
  };

  const handleFormError = (error: string) => {
    setResult({ type: 'error', message: error });
  };

  // Format title with date and price when invoice is provided
  const title = invoice
    ? `${formatDate(getInvoiceDate(invoice))} - ${formatCurrency(invoice.amount_remaining, invoice.currency)}`
    : 'Make Payment';

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
          accountId={accountId}
          onSuccess={onSuccess}
          onClose={onClose}
          onPaymentMethodAdded={onPaymentMethodAdded}
          onFormSuccess={handleFormSuccess}
          onFormError={handleFormError}
          isOpen={isOpen}
          outstandingAmount={outstandingAmount}
        />
      </Elements>
    </Modal>
  );
}
