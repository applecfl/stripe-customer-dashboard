'use client';

import { useState, useEffect, useMemo } from 'react';
import { PaymentMethodData, InvoiceFrequency } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Modal, ModalFooter, Button, Input, Textarea } from '@/components/ui';
import { Plus, CreditCard, Calendar, Check, Trash2, FileText } from 'lucide-react';

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  paymentMethods: PaymentMethodData[];
  currency: string;
  token?: string;
  accountId?: string;
  invoiceUID?: string;
  onSuccess: () => void;
  onAddCard?: () => void;
}

const FREQUENCY_OPTIONS: { value: InvoiceFrequency; label: string; description: string }[] = [
  { value: 'Weekly', label: 'Weekly', description: 'Every 7 days' },
  { value: 'Bi-Weekly', label: 'Bi-Weekly', description: 'Every 14 days' },
  { value: 'Monthly', label: 'Monthly', description: 'Every month' },
  { value: 'Dates', label: 'Custom Dates', description: 'Specific dates' },
];

// Get today's date in YYYY-MM-DD format
const getTodayDate = () => new Date().toISOString().split('T')[0];

export function CreateInvoiceModal({
  isOpen,
  onClose,
  customerId,
  paymentMethods,
  currency,
  token,
  accountId,
  invoiceUID: defaultInvoiceUID = '',
  onSuccess,
  onAddCard,
}: CreateInvoiceModalProps) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [frequency, setFrequency] = useState<InvoiceFrequency>('Monthly');
  const [startDate, setStartDate] = useState('');
  const [cycles, setCycles] = useState('1');
  const [customDates, setCustomDates] = useState<string[]>([]);
  const [newDate, setNewDate] = useState('');
  const [invoiceUID, setInvoiceUID] = useState('');
  const [firstPaymentNumber, setFirstPaymentNumber] = useState('1');
  const [manualEndDate, setManualEndDate] = useState(false);
  const [endDateValue, setEndDateValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setAmount('');
      setDescription('');
      const defaultPm = paymentMethods.find(pm => pm.isDefault);
      setPaymentMethodId(defaultPm?.id || paymentMethods[0]?.id || '');
      setFrequency('Monthly');
      setStartDate(getTodayDate());
      setCycles('1');
      setCustomDates([]);
      setNewDate('');
      setInvoiceUID(defaultInvoiceUID);
      setFirstPaymentNumber('1');
      setManualEndDate(false);
      setEndDateValue('');
      setError('');
      setSuccess(false);
      setCreatedCount(0);
      setSuccessMessage('');
    }
  }, [isOpen, paymentMethods, defaultInvoiceUID]);

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

  // Calculate cycles from end date when manual end date is enabled
  const calculatedCycles = useMemo(() => {
    if (!manualEndDate || !startDate || !endDateValue) return parseInt(cycles) || 1;

    const start = new Date(startDate);
    const end = new Date(endDateValue);
    if (end <= start) return 1;

    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

    switch (frequency) {
      case 'Weekly':
        return Math.floor(diffDays / 7) + 1;
      case 'Bi-Weekly':
        return Math.floor(diffDays / 14) + 1;
      case 'Monthly':
        const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
        return Math.max(1, months + 1);
      default:
        return parseInt(cycles) || 1;
    }
  }, [manualEndDate, startDate, endDateValue, frequency, cycles]);

  // Get effective number of payments
  const effectiveNumPayments = useMemo(() => {
    if (frequency === 'Dates') {
      return customDates.length || 1;
    }
    return manualEndDate ? calculatedCycles : (parseInt(cycles) || 1);
  }, [frequency, customDates.length, manualEndDate, calculatedCycles, cycles]);

  // Calculate end date - one day after the last payment
  const endDate = useMemo(() => {
    if (frequency === 'Dates') {
      if (customDates.length === 0) return null;
      const sortedDates = customDates.map(d => new Date(d)).sort((a, b) => b.getTime() - a.getTime());
      const lastPayment = sortedDates[0];
      lastPayment.setDate(lastPayment.getDate() + 1); // Add one day
      return lastPayment;
    }

    if (!startDate) return null;
    const start = new Date(startDate);
    const numPayments = effectiveNumPayments;

    const lastDate = new Date(start);
    switch (frequency) {
      case 'Weekly':
        lastDate.setDate(lastDate.getDate() + (numPayments - 1) * 7);
        break;
      case 'Bi-Weekly':
        lastDate.setDate(lastDate.getDate() + (numPayments - 1) * 14);
        break;
      case 'Monthly':
        lastDate.setMonth(lastDate.getMonth() + (numPayments - 1));
        break;
    }
    lastDate.setDate(lastDate.getDate() + 1); // Add one day after last payment
    return lastDate;
  }, [frequency, startDate, customDates, effectiveNumPayments]);

  // Calculate preview of invoices (needs amount for per-payment calculation)
  const { invoicePreview, perPaymentAmount, totalAmountCents } = useMemo(() => {
    const totalCents = amount ? Math.round(parseFloat(amount) * 100) : 0;
    if (totalCents <= 0) return { invoicePreview: [], perPaymentAmount: 0, totalAmountCents: 0 };

    const previews: { date: Date; amount: number; label: string }[] = [];
    const numPayments = effectiveNumPayments;
    const perPayment = Math.round(totalCents / numPayments);

    if (frequency === 'Dates') {
      customDates.forEach((d, i) => {
        previews.push({ date: new Date(d), amount: perPayment, label: `Payment ${i + 1}` });
      });
    } else {
      const start = startDate ? new Date(startDate) : new Date();

      for (let i = 0; i < numPayments; i++) {
        const date = new Date(start);
        switch (frequency) {
          case 'Weekly':
            date.setDate(date.getDate() + i * 7);
            break;
          case 'Bi-Weekly':
            date.setDate(date.getDate() + i * 14);
            break;
          case 'Monthly':
            date.setMonth(date.getMonth() + i);
            break;
        }
        previews.push({ date, amount: perPayment, label: `Payment ${i + 1}` });
      }
    }

    return { invoicePreview: previews, perPaymentAmount: perPayment, totalAmountCents: totalCents };
  }, [amount, frequency, startDate, customDates, effectiveNumPayments]);

  const handleAddDate = () => {
    if (newDate && !customDates.includes(newDate)) {
      setCustomDates([...customDates, newDate].sort());
      setNewDate('');
    }
  };

  const handleRemoveDate = (dateToRemove: string) => {
    setCustomDates(customDates.filter(d => d !== dateToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!amount || totalAmountCents <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    // Validate based on frequency
    if (['Weekly', 'Bi-Weekly', 'Monthly'].includes(frequency)) {
      if (!startDate) {
        setError('Please select a start date');
        return;
      }
      if (!manualEndDate && (!cycles || parseInt(cycles) < 1)) {
        setError('Please enter a valid number of payments');
        return;
      }
    }

    if (frequency === 'Dates' && customDates.length === 0) {
      setError('Please add at least one date');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(withToken('/api/stripe/invoices/create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          amount: perPaymentAmount, // Send per-payment amount, not total
          description: description.trim(),
          paymentMethodId: paymentMethodId || undefined,
          currency,
          frequency,
          cycles: ['Weekly', 'Bi-Weekly', 'Monthly'].includes(frequency)
            ? (manualEndDate ? calculatedCycles : parseInt(cycles))
            : undefined,
          startDate: frequency !== 'Dates' ? startDate : undefined,
          dates: frequency === 'Dates' ? customDates : undefined,
          firstPaymentNumber: parseInt(firstPaymentNumber) || 1,
          metadata: invoiceUID ? { InvoiceUID: invoiceUID } : undefined,
          accountId,
        }),
      });

      const result = await response.json();

      // Handle external API response format
      if (result.Success === 0 || result.success === false) {
        throw new Error(result.error || result.Message || 'Failed to create invoices');
      }

      setCreatedCount(invoicePreview.length);
      setSuccessMessage(result.Message || 'Invoices created successfully');
      setSuccess(true);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invoice(s)');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError('');
    setSuccess(false);
    onClose();
  };

  // Show success state inside modal
  if (success) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title="Multi Payment" size="lg">
        <div className="py-6 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-green-900 mb-2">
            {createdCount === 1 ? 'Payment Created' : `${createdCount} Payments Created`}
          </h3>
          <p className="text-sm text-green-700">
            {successMessage}
          </p>
        </div>
        <ModalFooter>
          <Button onClick={handleClose}>
            Done
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Multi Payment" size="lg">
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {/* Frequency Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Frequency
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {FREQUENCY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFrequency(opt.value)}
                  className={`p-2 rounded-lg border text-left transition-colors ${
                    frequency === opt.value
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Start Date and End Date (side by side for recurring) */}
          {frequency !== 'Dates' && (
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Start Date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    End Date
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={manualEndDate}
                      onChange={(e) => {
                        setManualEndDate(e.target.checked);
                        if (e.target.checked && endDate) {
                          setEndDateValue(endDate.toISOString().split('T')[0]);
                        }
                      }}
                      className="w-3.5 h-3.5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                    />
                    <span className="text-xs text-gray-500">Edit</span>
                  </label>
                </div>
                {manualEndDate ? (
                  <input
                    type="date"
                    value={endDateValue}
                    onChange={(e) => setEndDateValue(e.target.value)}
                    min={startDate || new Date().toISOString().split('T')[0]}
                    className="block w-full px-4 py-2.5 text-gray-900 bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                ) : (
                  <div className="block w-full px-4 py-2.5 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg shadow-sm">
                    {endDate
                      ? endDate.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : '—'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Custom Dates */}
          {frequency === 'Dates' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Custom Dates
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddDate}
                  disabled={!newDate}
                >
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
              </div>
              {customDates.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto border border-gray-200 rounded-lg p-2">
                  {customDates.map((date) => (
                    <div
                      key={date}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded"
                    >
                      <span className="text-sm text-gray-700">
                        {new Date(date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveDate(date)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Number of Payments */}
          {['Weekly', 'Bi-Weekly', 'Monthly'].includes(frequency) && (
            manualEndDate ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Number of Payments
                </label>
                <div className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-700">
                  {calculatedCycles} payment{calculatedCycles !== 1 ? 's' : ''} (calculated)
                </div>
              </div>
            ) : (
              <Input
                label="Number of Payments"
                type="number"
                min="1"
                max="100"
                value={cycles}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '' || parseInt(val) >= 1) {
                    setCycles(val);
                  }
                }}
              />
            )
          )}

          {/* Amount (Total) */}
          <Input
            label="Total Amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          {/* Summary: Each payment of & Total */}
          {invoicePreview.length > 0 && (
            <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100">
              <div className="flex justify-between items-center text-sm">
                <span className="text-indigo-700">
                  {invoicePreview.length} payment{invoicePreview.length > 1 ? 's' : ''} of{' '}
                  <span className="font-semibold">{formatCurrency(perPaymentAmount, currency)}</span> each
                </span>
                <span className="text-indigo-900 font-semibold">
                  Total: {formatCurrency(totalAmountCents, currency)}
                </span>
              </div>
            </div>
          )}

          {/* Description */}
          <Textarea
            label="Description"
            placeholder="Enter payment description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />

          {/* Payment Method Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Payment Method
              </label>
              {onAddCard && (
                <button
                  type="button"
                  onClick={onAddCard}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Card
                </button>
              )}
            </div>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-36 overflow-y-auto">
              {paymentMethods.map((pm) => (
                <label
                  key={pm.id}
                  className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                    paymentMethodId === pm.id ? 'bg-indigo-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={pm.id}
                    checked={paymentMethodId === pm.id}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                    className="w-4 h-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                  />
                  <CreditCard className="w-4 h-4 text-gray-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      <span className="capitalize">{pm.card?.brand}</span>
                      {' •••• '}
                      {pm.card?.last4}
                    </p>
                  </div>
                  {pm.isDefault && (
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">
                      Default
                    </span>
                  )}
                </label>
              ))}
              {paymentMethods.length === 0 && (
                <p className="p-3 text-sm text-gray-500">No payment methods available</p>
              )}
            </div>
          </div>

          {/* Advanced Options */}
          <details className="border border-gray-200 rounded-lg">
            <summary className="p-3 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-50">
              Advanced Options
            </summary>
            <div className="p-3 pt-0 space-y-3 border-t border-gray-200">
              <Input
                label="Invoice UID (optional)"
                placeholder="e.g., ABC123-456"
                value={invoiceUID}
                onChange={(e) => setInvoiceUID(e.target.value)}
              />
              <Input
                label="First Payment Number"
                type="number"
                min="1"
                value={firstPaymentNumber}
                onChange={(e) => setFirstPaymentNumber(e.target.value)}
              />
            </div>
          </details>

          {/* Preview */}
          {invoicePreview.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-gray-600" />
                <span className="text-sm font-medium text-gray-800">
                  Schedule Preview
                </span>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {invoicePreview.slice(0, 5).map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 bg-white rounded border border-gray-100"
                  >
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3 h-3 text-gray-400" />
                      <span className="text-sm text-gray-700">
                        {p.date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-gray-900">
                      {formatCurrency(p.amount, currency)}
                    </span>
                  </div>
                ))}
                {invoicePreview.length > 5 && (
                  <p className="text-xs text-gray-500 text-center py-1">
                    +{invoicePreview.length - 5} more payments
                  </p>
                )}
              </div>
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
          <Button type="submit" loading={loading}>
            <Plus className="w-4 h-4" />
            Create {invoicePreview.length > 1 ? `${invoicePreview.length} Payments` : 'Payment'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
