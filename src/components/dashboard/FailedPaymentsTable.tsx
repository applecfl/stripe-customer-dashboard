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
  AlertTriangle,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Save,
  X,
  Loader2,
  CreditCard,
  Calendar,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Mail,
  DollarSign,
  Pause,
  Play,
  Ban,
} from 'lucide-react';

interface FailedPaymentsTableProps {
  invoices: InvoiceData[];
  paymentMethods?: PaymentMethodData[];
  token?: string;
  onRefresh: () => void;
  onPayInvoice: (invoice: InvoiceData) => void;
  onVoidInvoice: (invoice: InvoiceData) => void;
  onPauseInvoice: (invoice: InvoiceData, pause: boolean) => void;
  onRetryInvoice: (invoice: InvoiceData) => void;
  onSendReminder: (invoice: InvoiceData) => void;
}

export function FailedPaymentsTable({
  invoices,
  paymentMethods = [],
  token,
  onRefresh,
  onPayInvoice,
  onVoidInvoice,
  onPauseInvoice,
  onRetryInvoice,
  onSendReminder,
}: FailedPaymentsTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // Create a map for quick payment method lookup
  const paymentMethodMap = new Map(paymentMethods.map(pm => [pm.id, pm]));

  // Get payment method for an invoice
  const getPaymentMethod = (invoice: InvoiceData): PaymentMethodData | null => {
    if (invoice.default_payment_method) {
      return paymentMethodMap.get(invoice.default_payment_method) || null;
    }
    return paymentMethods.find(pm => pm.isDefault) || null;
  };

  // Amount editing state
  const [editingAmount, setEditingAmount] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pendingAmounts, setPendingAmounts] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const amountInputRef = useRef<HTMLInputElement>(null);

  // Clear refreshing state when invoice data changes
  useEffect(() => {
    setRefreshingId(prev => prev ? null : prev);
  }, [invoices]);

  // Helper to add token to API URLs
  const withToken = (url: string) => {
    if (!token) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingAmount && amountInputRef.current) {
      amountInputRef.current.focus();
      amountInputRef.current.select();
    }
  }, [editingAmount]);

  // Start editing amount
  const startEditAmount = (invoice: InvoiceData) => {
    const currentAmount = pendingAmounts[invoice.id] ?? invoice.amount_due;
    setEditingAmount(invoice.id);
    setEditValue((currentAmount / 100).toFixed(2));
  };

  // Finish editing amount
  const finishEditAmount = (invoice: InvoiceData) => {
    const newAmount = Math.round(parseFloat(editValue) * 100);
    if (!isNaN(newAmount) && newAmount > 0 && newAmount !== invoice.amount_due) {
      setPendingAmounts(prev => ({
        ...prev,
        [invoice.id]: newAmount,
      }));
    }
    setEditingAmount(null);
  };

  // Cancel changes
  const cancelChanges = (invoiceId: string) => {
    setPendingAmounts(prev => {
      const newAmounts = { ...prev };
      delete newAmounts[invoiceId];
      return newAmounts;
    });
  };

  // Save amount changes
  const saveChanges = async (invoice: InvoiceData) => {
    const newAmount = pendingAmounts[invoice.id];
    if (newAmount === undefined || newAmount === invoice.amount_due) return;

    setSaving(invoice.id);
    setError(null);

    try {
      const res = await fetch(withToken('/api/stripe/invoices/adjust'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          newAmount,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to update amount');
      }

      cancelChanges(invoice.id);
      setRefreshingId(invoice.id);
      onRefresh();
    } catch (err) {
      console.error('Failed to save amount:', err);
      setError(err instanceof Error ? err.message : 'Failed to save amount');
    } finally {
      setSaving(null);
    }
  };

  // Handle key events
  const handleKeyDown = (e: React.KeyboardEvent, invoice: InvoiceData) => {
    if (e.key === 'Enter') {
      finishEditAmount(invoice);
    } else if (e.key === 'Escape') {
      setEditingAmount(null);
    }
  };

  // Check if invoice has pending changes
  const hasChanges = (invoice: InvoiceData): boolean => {
    const pendingAmount = pendingAmounts[invoice.id];
    return pendingAmount !== undefined && pendingAmount !== invoice.amount_due;
  };

  // Get displayed amount
  const getDisplayedAmount = (invoice: InvoiceData): number => {
    return pendingAmounts[invoice.id] ?? invoice.amount_due;
  };

  const copyToClipboard = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Only show failed invoices (open with payment attempts)
  const failedInvoices = invoices
    .filter(inv => inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0)
    .sort((a, b) => (b.due_date || b.created) - (a.due_date || a.created));

  if (failedInvoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-gray-400" />
            Failed Payments
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No failed payments
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-sm text-gray-500">
            {failedInvoices.length} payment{failedInvoices.length !== 1 ? 's' : ''}
          </span>
        }
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          Failed Payments
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
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow hoverable={false}>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead className="w-[100px]">Amount</TableHead>
              <TableHead className="w-[100px]"><span className="hidden sm:inline">Due </span>Date</TableHead>
              <TableHead className="w-[140px]"><span className="hidden sm:inline">Payment </span>Card</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {failedInvoices.map((invoice) => {
              const invoiceHasChanges = hasChanges(invoice);
              const isSaving = saving === invoice.id;
              const isRefreshing = refreshingId === invoice.id;
              const displayedAmount = getDisplayedAmount(invoice);
              const amountChanged = pendingAmounts[invoice.id] !== undefined &&
                pendingAmounts[invoice.id] !== invoice.amount_due;

              // Show skeleton row while refreshing
              if (isRefreshing) {
                return (
                  <TableRow key={invoice.id} className="bg-gray-50/50 animate-pulse">
                    <TableCell>
                      <div className="flex items-center gap-0.5 sm:gap-1">
                        <div className="w-6 h-6 bg-gray-200 rounded" />
                        <div className="w-6 h-6 bg-gray-200 rounded hidden sm:block" />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="h-5 w-16 sm:w-20 bg-gray-200 rounded" />
                    </TableCell>
                    <TableCell>
                      <div className="h-5 w-20 sm:w-24 bg-gray-200 rounded" />
                    </TableCell>
                    <TableCell>
                      <div className="h-5 w-16 sm:w-24 bg-gray-200 rounded" />
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex justify-end gap-2">
                        <div className="h-5 w-24 sm:w-32 bg-gray-200 rounded" />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }

              return (
                <TableRow key={invoice.id} className={`bg-red-50/50 ${invoiceHasChanges ? 'bg-amber-50/50' : ''}`}>
                  <TableCell>
                    <div className="flex items-center gap-0.5 sm:gap-1">
                      <button
                        onClick={() => copyToClipboard(invoice.id)}
                        className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors"
                        title={invoice.id}
                      >
                        {copiedId === invoice.id ? (
                          <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" />
                        )}
                      </button>
                      <a
                        href={`https://dashboard.stripe.com/invoices/${invoice.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors hidden sm:block"
                        title="Open in Stripe"
                      >
                        <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 hover:text-indigo-600" />
                      </a>
                    </div>
                  </TableCell>
                  <TableCell>
                    {editingAmount === invoice.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500 text-xs sm:text-sm">$</span>
                        <input
                          ref={amountInputRef}
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, invoice)}
                          onBlur={() => finishEditAmount(invoice)}
                          className="w-16 sm:w-20 px-1.5 sm:px-2 py-0.5 sm:py-1 text-xs sm:text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          disabled={isSaving}
                        />
                      </div>
                    ) : (
                      <div>
                        <button
                          onClick={() => startEditAmount(invoice)}
                          className={`font-semibold text-xs sm:text-sm px-1.5 sm:px-2 py-0.5 sm:py-1 rounded transition-colors ${amountChanged
                            ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                            : 'text-red-700 hover:text-indigo-600 hover:bg-indigo-50'
                            }`}
                        >
                          {formatCurrency(displayedAmount, invoice.currency)}
                        </button>
                        {invoice.amount_remaining > 0 && invoice.amount_remaining !== invoice.amount_due && !amountChanged && (
                          <p className="text-[10px] sm:text-xs text-amber-600">
                            {formatCurrency(invoice.amount_remaining, invoice.currency)} <span className="hidden sm:inline">remaining</span>
                          </p>
                        )}
                      </div>
                    )}
                  </TableCell>

                  {/* Date Cell */}
                  <TableCell>
                    <div className="flex items-center gap-1 sm:gap-1.5 text-gray-600">
                      <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400" />
                      <span className="text-xs sm:text-sm">
                        {invoice.due_date
                          ? formatDate(invoice.due_date)
                          : 'Not set'}
                      </span>
                    </div>
                  </TableCell>

                  {/* Payment Method Cell */}
                  <TableCell>
                    {(() => {
                      const pm = getPaymentMethod(invoice);
                      return pm ? (
                        <div className="flex items-center gap-1.5 sm:gap-2 text-gray-600">
                          <div className="w-6 h-4 sm:w-8 sm:h-5 rounded bg-gray-100 flex items-center justify-center">
                            <CreditCard className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-500" />
                          </div>
                          <span className="text-xs sm:text-sm">
                            <span className="capitalize hidden sm:inline">{pm.card?.brand}</span>
                            <span className="hidden sm:inline">{' •••• '}</span>
                            <span className="sm:hidden">••</span>
                            {pm.card?.last4}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs sm:text-sm text-gray-400">No card</span>
                      );
                    })()}
                  </TableCell>

                  <TableCell align="right">
                    {invoiceHasChanges ? (
                      /* Save/Cancel buttons when there are pending changes */
                      <div className="flex items-center justify-end gap-1 sm:gap-2">
                        <button
                          onClick={() => saveChanges(invoice)}
                          disabled={isSaving}
                          className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm rounded transition-colors disabled:opacity-50"
                        >
                          {isSaving ? (
                            <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" />
                          ) : (
                            <Save className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          )}
                          <span className="hidden sm:inline">Save</span>
                        </button>
                        <button
                          onClick={() => cancelChanges(invoice.id)}
                          disabled={isSaving}
                          className="p-0.5 sm:p-1 hover:bg-gray-100 text-gray-500 rounded transition-colors"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* Desktop: action buttons with icons */}
                        <div className="hidden sm:flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onRetryInvoice(invoice)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
                            title="Retry Payment"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Retry
                          </button>
                          <button
                            onClick={() => onSendReminder(invoice)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors"
                            title="Send Reminder Email"
                          >
                            <Mail className="w-3.5 h-3.5" />
                            Remind
                          </button>
                          <button
                            onClick={() => onPayInvoice(invoice)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
                            title="Pay Invoice"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            Pay
                          </button>
                          <button
                            onClick={() => onPauseInvoice(invoice, !invoice.isPaused)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                            title={invoice.isPaused ? 'Resume Auto-retry' : 'Pause Auto-retry'}
                          >
                            {invoice.isPaused ? (
                              <Play className="w-3.5 h-3.5" />
                            ) : (
                              <Pause className="w-3.5 h-3.5" />
                            )}
                            {invoice.isPaused ? 'Resume' : 'Pause'}
                          </button>
                          <button
                            onClick={() => onVoidInvoice(invoice)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                            title="Void Invoice"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Void
                          </button>
                        </div>
                        {/* Mobile: compact icon buttons */}
                        <div className="sm:hidden flex items-center justify-end gap-1">
                          <button
                            onClick={() => onRetryInvoice(invoice)}
                            className="p-1.5 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors"
                            title="Retry Payment"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onSendReminder(invoice)}
                            className="p-1.5 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors"
                            title="Send Reminder"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onPayInvoice(invoice)}
                            className="p-1.5 text-green-600 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
                            title="Pay Invoice"
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onPauseInvoice(invoice, !invoice.isPaused)}
                            className="p-1.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                            title={invoice.isPaused ? 'Resume' : 'Pause'}
                          >
                            {invoice.isPaused ? (
                              <Play className="w-4 h-4" />
                            ) : (
                              <Pause className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => onVoidInvoice(invoice)}
                            className="p-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                            title="Void Invoice"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        </div>
                      </>
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
