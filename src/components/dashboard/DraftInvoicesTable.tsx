'use client';

import { useState, useRef, useEffect } from 'react';
import { InvoiceData, PaymentMethodData } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Card,
  CardHeader,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import {
  Clock,
  Copy,
  Check,
  CreditCard,
  ChevronDown,
  Calendar,
  Loader2,
  X,
  Save,
  ExternalLink,
} from 'lucide-react';

interface FutureInvoicesTableProps {
  invoices: InvoiceData[];
  paymentMethods?: PaymentMethodData[];
  token?: string;
  onRefresh: () => void;
  // Keep old props for compatibility but we won't use them
  onChangeDueDate?: (invoice: InvoiceData) => void;
  onAdjustAmount?: (invoice: InvoiceData) => void;
  onChangePaymentMethod?: (invoice: InvoiceData) => void;
  onPauseInvoice?: (invoice: InvoiceData, pause: boolean) => void;
  onDeleteInvoice?: (invoice: InvoiceData) => void;
  onBulkChangeDueDate?: () => void;
  onBulkChangePaymentMethod?: () => void;
  onBulkPause?: (pause: boolean) => void;
  onBulkDelete?: (invoiceIds: string[]) => void;
}

// Track pending changes for each invoice
interface PendingChanges {
  amount?: number; // in cents
  date?: number; // unix timestamp
  paymentMethodId?: string;
}

export function FutureInvoicesTable({
  invoices,
  paymentMethods = [],
  token,
  onRefresh,
}: FutureInvoicesTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Track pending changes per invoice
  const [pendingChanges, setPendingChanges] = useState<Record<string, PendingChanges>>({});

  // UI state for editing (which field is currently being edited)
  const [editingAmount, setEditingAmount] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amountInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Helper to add token to API URLs
  const withToken = (url: string) => {
    if (!token) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  };

  const copyToClipboard = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Helper to get finalize date for sorting (prioritize metadata.scheduledFinalizeAt)
  const getFinalizeDate = (inv: InvoiceData): number => {
    if (inv.metadata?.scheduledFinalizeAt) return parseInt(inv.metadata.scheduledFinalizeAt, 10);
    if (inv.automatically_finalizes_at) return inv.automatically_finalizes_at;
    return inv.due_date || inv.created;
  };

  // Filter to only draft invoices, sorted by finalize date
  const draftInvoices = invoices
    .filter(inv => inv.status === 'draft')
    .sort((a, b) => getFinalizeDate(a) - getFinalizeDate(b));

  // Create a map for quick payment method lookup
  const paymentMethodMap = new Map(paymentMethods.map(pm => [pm.id, pm]));

  // Get payment method for an invoice
  const getPaymentMethod = (invoice: InvoiceData): PaymentMethodData | null => {
    if (invoice.default_payment_method) {
      return paymentMethodMap.get(invoice.default_payment_method) || null;
    }
    return paymentMethods.find(pm => pm.isDefault) || null;
  };

  // Get current displayed payment method (pending change or original)
  const getDisplayedPaymentMethod = (invoice: InvoiceData): PaymentMethodData | null => {
    const changes = pendingChanges[invoice.id];
    if (changes?.paymentMethodId) {
      return paymentMethodMap.get(changes.paymentMethodId) || null;
    }
    return getPaymentMethod(invoice);
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingAmount && amountInputRef.current) {
      amountInputRef.current.focus();
      amountInputRef.current.select();
    }
  }, [editingAmount]);

  useEffect(() => {
    if (editingDate && dateInputRef.current) {
      dateInputRef.current.focus();
    }
  }, [editingDate]);

  // Get the original scheduled date from invoice (before any pending changes)
  // Prioritize metadata.scheduledFinalizeAt since that's where we store user's custom date
  const getOriginalDate = (invoice: InvoiceData): number | null => {
    if (invoice.metadata?.scheduledFinalizeAt) return parseInt(invoice.metadata.scheduledFinalizeAt, 10);
    if (invoice.automatically_finalizes_at) return invoice.automatically_finalizes_at;
    return invoice.due_date || null;
  };

  // Check if invoice has pending changes
  const hasChanges = (invoice: InvoiceData): boolean => {
    const changes = pendingChanges[invoice.id];
    if (!changes) return false;

    const amountChanged = changes.amount !== undefined && changes.amount !== invoice.amount_due;
    const originalDate = getOriginalDate(invoice);
    const dateChanged = changes.date !== undefined && changes.date !== originalDate;
    const pmChanged = changes.paymentMethodId !== undefined && changes.paymentMethodId !== invoice.default_payment_method;

    return amountChanged || dateChanged || pmChanged;
  };

  // Start editing amount
  const startEditAmount = (invoice: InvoiceData) => {
    const currentAmount = pendingChanges[invoice.id]?.amount ?? invoice.amount_due;
    setEditingAmount(invoice.id);
    setEditValue((currentAmount / 100).toFixed(2));
  };

  // Finish editing amount (on blur)
  const finishEditAmount = (invoice: InvoiceData) => {
    const newAmount = Math.round(parseFloat(editValue) * 100);
    if (!isNaN(newAmount) && newAmount > 0 && newAmount !== invoice.amount_due) {
      setPendingChanges(prev => ({
        ...prev,
        [invoice.id]: { ...prev[invoice.id], amount: newAmount },
      }));
    }
    setEditingAmount(null);
  };

  // Start editing date
  const startEditDate = (invoice: InvoiceData) => {
    const currentDate = pendingChanges[invoice.id]?.date ?? getOriginalDate(invoice);
    setEditingDate(invoice.id);
    setEditValue(formatDateForInput(currentDate));
  };

  // Finish editing date (on blur)
  const finishEditDate = (invoice: InvoiceData) => {
    const newDate = new Date(editValue + 'T00:00:00');
    if (!isNaN(newDate.getTime())) {
      const timestamp = Math.floor(newDate.getTime() / 1000);
      const originalDate = getOriginalDate(invoice);
      // Compare dates by day only (ignore time differences)
      const originalDateOnly = originalDate ? Math.floor(new Date(originalDate * 1000).setHours(0, 0, 0, 0) / 1000) : null;
      const newDateOnly = Math.floor(new Date(timestamp * 1000).setHours(0, 0, 0, 0) / 1000);

      console.log('Date comparison:', { editValue, timestamp, originalDate, originalDateOnly, newDateOnly, changed: newDateOnly !== originalDateOnly });

      if (newDateOnly !== originalDateOnly) {
        setPendingChanges(prev => ({
          ...prev,
          [invoice.id]: { ...prev[invoice.id], date: timestamp },
        }));
      }
    }
    setEditingDate(null);
  };

  // Handle payment method change
  const handlePaymentMethodChange = (invoiceId: string, paymentMethodId: string) => {
    setPendingChanges(prev => ({
      ...prev,
      [invoiceId]: { ...prev[invoiceId], paymentMethodId },
    }));
    setEditingCard(null);
  };

  // Cancel changes for an invoice
  const cancelChanges = (invoiceId: string) => {
    setPendingChanges(prev => {
      const newChanges = { ...prev };
      delete newChanges[invoiceId];
      return newChanges;
    });
  };

  // Save all changes for an invoice
  const saveChanges = async (invoice: InvoiceData) => {
    const changes = pendingChanges[invoice.id];
    if (!changes) return;

    setSaving(invoice.id);
    setError(null);

    try {
      const originalDate = getOriginalDate(invoice);

      // Save amount if changed
      if (changes.amount !== undefined && changes.amount !== invoice.amount_due) {
        const res = await fetch(withToken('/api/stripe/invoices/adjust'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoice.id,
            newAmount: changes.amount,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to update amount');
        }
      }

      // Save date if changed
      console.log('Checking date change:', { changesDate: changes.date, originalDate, shouldSave: changes.date !== undefined && changes.date !== originalDate });
      if (changes.date !== undefined && changes.date !== originalDate) {
        console.log('Saving date change:', { invoiceId: invoice.id, scheduledDate: changes.date });
        const res = await fetch(withToken('/api/stripe/invoices/schedule'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoice.id,
            scheduledDate: changes.date,
          }),
        });
        const data = await res.json();
        console.log('Schedule API response:', data);
        if (!data.success) {
          throw new Error(data.error || 'Failed to update finalize date');
        }
      }

      // Save payment method if changed
      if (changes.paymentMethodId !== undefined && changes.paymentMethodId !== invoice.default_payment_method) {
        const res = await fetch(withToken('/api/stripe/invoices/payment-method'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoice.id,
            paymentMethodId: changes.paymentMethodId,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to update payment method');
        }
      }

      // Clear pending changes for this invoice
      cancelChanges(invoice.id);
      onRefresh();
    } catch (err) {
      console.error('Failed to save changes:', err);
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(null);
    }
  };

  // Get displayed amount (pending or original)
  const getDisplayedAmount = (invoice: InvoiceData): number => {
    return pendingChanges[invoice.id]?.amount ?? invoice.amount_due;
  };

  // Get displayed date (pending or original)
  // Prioritize metadata.scheduledFinalizeAt since that's where we store user's custom date
  const getDisplayedDate = (invoice: InvoiceData): number | null => {
    const changes = pendingChanges[invoice.id];
    if (changes?.date !== undefined) return changes.date;
    // Check multiple sources - prioritize our custom metadata field
    if (invoice.metadata?.scheduledFinalizeAt) return parseInt(invoice.metadata.scheduledFinalizeAt, 10);
    if (invoice.automatically_finalizes_at) return invoice.automatically_finalizes_at;
    return invoice.due_date || null;
  };

  // Format date for input
  const formatDateForInput = (timestamp: number | null): string => {
    if (!timestamp) return new Date().toISOString().split('T')[0];
    return new Date(timestamp * 1000).toISOString().split('T')[0];
  };

  // Handle key events
  const handleKeyDown = (e: React.KeyboardEvent, invoice: InvoiceData, type: 'amount' | 'date') => {
    if (e.key === 'Enter') {
      if (type === 'amount') finishEditAmount(invoice);
      else finishEditDate(invoice);
    } else if (e.key === 'Escape') {
      setEditingAmount(null);
      setEditingDate(null);
    }
  };

  if (draftInvoices.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-sm text-gray-500">
            {draftInvoices.length} invoice{draftInvoices.length !== 1 ? 's' : ''}
          </span>
        }
      >
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-600" />
          Future
        </div>
      </CardHeader>

      <CardContent noPadding>
        {error && (
          <div className="mx-4 mt-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow hoverable={false}>
              <TableHead className="w-10"></TableHead>
              <TableHead align="right" className="w-32">Amount</TableHead>
              <TableHead className="w-44">Finalize Date</TableHead>
              <TableHead>Payment Method</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draftInvoices.map((invoice) => {
              const displayedPm = getDisplayedPaymentMethod(invoice);
              const invoiceHasChanges = hasChanges(invoice);
              const isSaving = saving === invoice.id;
              const displayedAmount = getDisplayedAmount(invoice);
              const displayedDate = getDisplayedDate(invoice);

              const amountChanged = pendingChanges[invoice.id]?.amount !== undefined &&
                pendingChanges[invoice.id]?.amount !== invoice.amount_due;
              const originalDate = getOriginalDate(invoice);
              const dateChanged = pendingChanges[invoice.id]?.date !== undefined &&
                pendingChanges[invoice.id]?.date !== originalDate;
              const pmChanged = pendingChanges[invoice.id]?.paymentMethodId !== undefined &&
                pendingChanges[invoice.id]?.paymentMethodId !== invoice.default_payment_method;

              return (
                <TableRow key={invoice.id} className={invoiceHasChanges ? 'bg-amber-50/50' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => copyToClipboard(invoice.id)}
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                        title={invoice.id}
                      >
                        {copiedId === invoice.id ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      <a
                        href={`https://dashboard.stripe.com/invoices/${invoice.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                        title="Open in Stripe"
                      >
                        <ExternalLink className="w-4 h-4 text-gray-400 hover:text-indigo-600" />
                      </a>
                    </div>
                  </TableCell>

                  {/* Amount Cell */}
                  <TableCell align="right">
                    {editingAmount === invoice.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-gray-500 text-sm">$</span>
                        <input
                          ref={amountInputRef}
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, invoice, 'amount')}
                          onBlur={() => finishEditAmount(invoice)}
                          className="w-20 px-2 py-1 text-right text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          disabled={isSaving}
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditAmount(invoice)}
                        className={`font-semibold px-2 py-1 rounded transition-colors ${
                          amountChanged
                            ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                            : 'text-gray-900 hover:text-indigo-600 hover:bg-indigo-50'
                        }`}
                      >
                        {formatCurrency(displayedAmount, invoice.currency)}
                      </button>
                    )}
                  </TableCell>

                  {/* Date Cell */}
                  <TableCell>
                    {editingDate === invoice.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          ref={dateInputRef}
                          type="date"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, invoice, 'date')}
                          onBlur={() => finishEditDate(invoice)}
                          className="px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          disabled={isSaving}
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditDate(invoice)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                          dateChanged
                            ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                            : 'text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
                        }`}
                      >
                        <Calendar className={`w-3.5 h-3.5 ${dateChanged ? 'text-amber-500' : 'text-gray-400'}`} />
                        <span className="text-sm">
                          {displayedDate
                            ? formatDate(displayedDate)
                            : 'Not set'}
                        </span>
                      </button>
                    )}
                  </TableCell>

                  {/* Payment Method Cell - Dropdown */}
                  <TableCell>
                    {editingCard === invoice.id ? (
                      <div className="relative">
                        <div className="absolute z-10 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg">
                          <div className="p-2 border-b border-gray-100 flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-500">Select Payment Method</span>
                            <button
                              onClick={() => setEditingCard(null)}
                              className="p-1 hover:bg-gray-100 rounded"
                            >
                              <X className="w-3 h-3 text-gray-400" />
                            </button>
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {paymentMethods.map((method) => {
                              const isSelected = pendingChanges[invoice.id]?.paymentMethodId === method.id ||
                                (!pendingChanges[invoice.id]?.paymentMethodId && method.id === invoice.default_payment_method);
                              return (
                                <button
                                  key={method.id}
                                  onClick={() => handlePaymentMethodChange(invoice.id, method.id)}
                                  className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors ${
                                    isSelected ? 'bg-indigo-50' : ''
                                  }`}
                                  disabled={isSaving}
                                >
                                  <div className="w-8 h-5 rounded bg-gray-100 flex items-center justify-center">
                                    <CreditCard className="w-3.5 h-3.5 text-gray-500" />
                                  </div>
                                  <span className="text-sm flex-1">
                                    <span className="capitalize">{method.card?.brand}</span>
                                    {' •••• '}
                                    {method.card?.last4}
                                  </span>
                                  {method.isDefault && (
                                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1 rounded">
                                      Default
                                    </span>
                                  )}
                                  {isSelected && (
                                    <Check className="w-4 h-4 text-indigo-600" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {/* Current value shown while dropdown is open */}
                        <div className="flex items-center gap-2 text-gray-400">
                          {displayedPm ? (
                            <>
                              <div className="w-8 h-5 rounded bg-gray-100 flex items-center justify-center">
                                <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                              </div>
                              <span className="text-sm">
                                <span className="capitalize">{displayedPm.card?.brand}</span>
                                {' •••• '}
                                {displayedPm.card?.last4}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm">Select card...</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingCard(invoice.id)}
                        className={`group flex items-center gap-2 px-2 py-1 rounded transition-colors ${
                          pmChanged
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                            : 'text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
                        }`}
                      >
                        {displayedPm ? (
                          <>
                            <div className={`w-8 h-5 rounded flex items-center justify-center ${
                              pmChanged ? 'bg-amber-200' : 'bg-gray-100 group-hover:bg-indigo-100'
                            }`}>
                              <CreditCard className={`w-3.5 h-3.5 ${
                                pmChanged ? 'text-amber-600' : 'text-gray-500 group-hover:text-indigo-500'
                              }`} />
                            </div>
                            <span className="text-sm">
                              <span className="capitalize">{displayedPm.card?.brand}</span>
                              {' •••• '}
                              {displayedPm.card?.last4}
                            </span>
                            {displayedPm.isDefault && !pmChanged && (
                              <span className="text-[10px] bg-gray-100 text-gray-500 px-1 rounded group-hover:bg-indigo-100 group-hover:text-indigo-600">
                                Default
                              </span>
                            )}
                            <ChevronDown className={`w-3.5 h-3.5 ${pmChanged ? 'text-amber-500' : 'text-gray-400 group-hover:text-indigo-500'}`} />
                          </>
                        ) : (
                          <>
                            <div className="w-8 h-5 rounded bg-amber-50 flex items-center justify-center group-hover:bg-indigo-100">
                              <CreditCard className="w-3.5 h-3.5 text-amber-500 group-hover:text-indigo-500" />
                            </div>
                            <span className="text-sm text-amber-600 group-hover:text-indigo-600">
                              No card set
                            </span>
                            <ChevronDown className="w-3.5 h-3.5 text-gray-400 group-hover:text-indigo-500" />
                          </>
                        )}
                      </button>
                    )}
                  </TableCell>

                  {/* Save/Cancel Actions */}
                  <TableCell>
                    {invoiceHasChanges && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => saveChanges(invoice)}
                          disabled={isSaving}
                          className="flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors disabled:opacity-50"
                        >
                          {isSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Save className="w-3.5 h-3.5" />
                          )}
                          <span>Save</span>
                        </button>
                        <button
                          onClick={() => cancelChanges(invoice.id)}
                          disabled={isSaving}
                          className="p-1 hover:bg-gray-100 text-gray-500 rounded transition-colors"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
