'use client';

import { useState, useEffect, useRef } from 'react';
import { InvoiceData } from '@/types';
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
  Modal,
  ModalFooter,
  Button,
  Textarea,
} from '@/components/ui';
import {
  AlertTriangle,
  Clock,
  Copy,
  Check,
  ExternalLink,
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
  AlertCircle,
  CheckCircle,
  XCircle,
  Save,
  StickyNote,
  X,
} from 'lucide-react';

// Payment attempt type from API
interface PaymentAttempt {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  failure_code: string | null;
  failure_message: string | null;
  payment_method_details: {
    brand: string | null;
    last4: string | null;
    exp_month: number | null;
    exp_year: number | null;
  } | null;
  outcome: {
    network_status: string | null;
    reason: string | null;
    risk_level: string | null;
    seller_message: string | null;
    type: string | null;
  } | null;
}

// Get the correct finalize/scheduled date for an invoice
// Priority: scheduledFinalizeAt → effective_at (finalized date) → due_date → created
const getInvoiceDate = (inv: InvoiceData): number | null => {
  // Check scheduledFinalizeAt first - this is the original scheduled date preserved in metadata
  if (inv.metadata?.scheduledFinalizeAt) return parseInt(inv.metadata.scheduledFinalizeAt, 10);
  // For finalized (open/paid) invoices, effective_at is when it was finalized
  if (inv.effective_at) return inv.effective_at;
  // Then check due_date
  if (inv.due_date) return inv.due_date;
  // Fallback to created
  return inv.created;
};

interface FailedPaymentsTableProps {
  invoices: InvoiceData[];
  token?: string;
  accountId?: string;
  onRefresh: () => void;
  onPayInvoice: (invoice: InvoiceData) => void;
  onVoidInvoice: (invoice: InvoiceData) => void;
  onPauseInvoice: (invoice: InvoiceData, pause: boolean) => void;
  onRetryInvoice: (invoice: InvoiceData) => void;
  onSendReminder: (invoice: InvoiceData) => void;
  onUpdatingChange?: (isUpdating: boolean) => void;
}

export function FailedPaymentsTable({
  invoices,
  token,
  accountId,
  onRefresh,
  onPayInvoice,
  onVoidInvoice,
  onPauseInvoice,
  onRetryInvoice,
  onSendReminder,
  onUpdatingChange,
}: FailedPaymentsTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [paymentAttempts, setPaymentAttempts] = useState<Record<string, PaymentAttempt[]>>({});
  const [loadingAttempts, setLoadingAttempts] = useState<Set<string>>(new Set());
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  // Inline amount editing state
  const [editingAmount, setEditingAmount] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingAmount, setSavingAmount] = useState<string | null>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Inline note editing state
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteEditValue, setNoteEditValue] = useState('');
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);

  // Pause confirmation modal state
  const [pauseModal, setPauseModal] = useState<{
    isOpen: boolean;
    invoice: InvoiceData | null;
    isPause: boolean; // true = pause, false = resume
  }>({ isOpen: false, invoice: null, isPause: true });
  const [pauseReason, setPauseReason] = useState('');
  const [pauseLoading, setPauseLoading] = useState(false);

  // Track which invoices we've already fetched attempts for (persists across re-renders)
  const fetchedAttemptsRef = useRef<Set<string>>(new Set());

  // Fetch payment attempts for an invoice
  const fetchPaymentAttempts = async (invoiceId: string) => {
    if (!accountId) return;

    // Skip if we've already fetched this invoice's attempts
    if (fetchedAttemptsRef.current.has(invoiceId)) return;

    setLoadingAttempts(prev => new Set(prev).add(invoiceId));
    fetchedAttemptsRef.current.add(invoiceId);

    try {
      let url = `/api/stripe/invoices/${invoiceId}/attempts?accountId=${encodeURIComponent(accountId)}`;
      if (token) {
        url += `&token=${encodeURIComponent(token)}`;
      }
      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setPaymentAttempts(prev => ({
          ...prev,
          [invoiceId]: data.data,
        }));
      }
    } catch (error) {
      console.error('Failed to fetch payment attempts:', error);
      // Remove from fetched set so it can be retried
      fetchedAttemptsRef.current.delete(invoiceId);
    } finally {
      setLoadingAttempts(prev => {
        const next = new Set(prev);
        next.delete(invoiceId);
        return next;
      });
    }
  };

  // Only show failed invoices (open with payment attempts)
  const failedInvoices = invoices
    .filter(inv => inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0)
    .sort((a, b) => (getInvoiceDate(b) || 0) - (getInvoiceDate(a) || 0));

  // Auto-fetch attempts for all failed invoices on mount (only once per invoice)
  useEffect(() => {
    failedInvoices.forEach(invoice => {
      if (!fetchedAttemptsRef.current.has(invoice.id) && !loadingAttempts.has(invoice.id)) {
        fetchPaymentAttempts(invoice.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedInvoices.map(i => i.id).join(','), accountId]);

  const toggleExpanded = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
    }
  };

  // Clear refreshing state when invoice data changes
  useEffect(() => {
    setRefreshingId(prev => prev ? null : prev);
  }, [invoices]);

  // Get the latest error info from attempts
  const getLatestError = (invoiceId: string): { message: string; date: number } | null => {
    const attempts = paymentAttempts[invoiceId];
    if (!attempts || attempts.length === 0) return null;

    // Find the most recent failed attempt
    const failedAttempt = attempts.find(a => a.status === 'failed');
    if (failedAttempt) {
      const message = failedAttempt.failure_message || failedAttempt.outcome?.seller_message || 'Payment failed';
      return { message, date: failedAttempt.created };
    }
    return null;
  };

  const copyToClipboard = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
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
    setEditingAmount(invoice.id);
    setEditValue((invoice.amount_due / 100).toFixed(2));
  };

  // Cancel editing
  const cancelEditAmount = () => {
    setEditingAmount(null);
    setEditValue('');
  };

  // Save amount change - uses credit note for open invoices
  const saveAmount = async (invoice: InvoiceData) => {
    const newAmount = Math.round(parseFloat(editValue) * 100);
    if (isNaN(newAmount) || newAmount <= 0 || newAmount === invoice.amount_due) {
      cancelEditAmount();
      return;
    }

    // For failed (open) invoices, can only reduce amount
    if (newAmount > invoice.amount_due) {
      console.error('Cannot increase amount on a failed invoice');
      cancelEditAmount();
      return;
    }

    setSavingAmount(invoice.id);
    try {
      let url = `/api/stripe/invoices/adjust`;
      if (token) {
        url += `?token=${encodeURIComponent(token)}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          newAmount,
          accountId,
        }),
      });

      if (response.ok) {
        // Refresh data after successful update
        onRefresh();
      } else {
        const data = await response.json();
        console.error('Failed to update amount:', data.error);
      }
    } catch (error) {
      console.error('Error updating amount:', error);
    } finally {
      setSavingAmount(null);
      setEditingAmount(null);
      setEditValue('');
    }
  };

  // Handle key press in amount input
  const handleAmountKeyDown = (e: React.KeyboardEvent, invoice: InvoiceData) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveAmount(invoice);
    } else if (e.key === 'Escape') {
      cancelEditAmount();
    }
  };

  // Get invoice note from metadata
  const getInvoiceNote = (invoice: InvoiceData): string => {
    return invoice.note || '';
  };

  // Get displayed note (pending or original)
  const getDisplayedNote = (invoice: InvoiceData): string => {
    if (pendingNotes[invoice.id] !== undefined) return pendingNotes[invoice.id];
    return getInvoiceNote(invoice);
  };

  // Start editing note
  const startEditNote = (invoice: InvoiceData) => {
    setNoteEditValue(getDisplayedNote(invoice));
    setEditingNote(invoice.id);
  };

  // Handle note input change
  const handleNoteInputChange = (invoiceId: string, newValue: string) => {
    setNoteEditValue(newValue);
    setPendingNotes(prev => ({ ...prev, [invoiceId]: newValue }));
  };

  // Close note editor
  const closeNoteEditor = () => {
    setEditingNote(null);
    setNoteEditValue('');
  };

  // Save note for an invoice
  const saveNoteOnly = async (invoice: InvoiceData) => {
    const pendingNote = pendingNotes[invoice.id];
    if (pendingNote === undefined || pendingNote === getInvoiceNote(invoice)) return;

    setSavingNote(invoice.id);
    try {
      let url = `/api/stripe/invoices/${invoice.id}`;
      if (token) {
        url += `?token=${encodeURIComponent(token)}`;
      }

      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-note',
          note: pendingNote.trim(),
          accountId,
        }),
      });

      if (response.ok) {
        setPendingNotes(prev => {
          const updated = { ...prev };
          delete updated[invoice.id];
          return updated;
        });
        onRefresh();
      } else {
        const data = await response.json();
        console.error('Failed to save note:', data.error);
      }
    } catch (error) {
      console.error('Error saving note:', error);
    } finally {
      setSavingNote(null);
    }
  };

  // Cancel note change
  const cancelNoteOnly = (invoiceId: string) => {
    setPendingNotes(prev => {
      const updated = { ...prev };
      delete updated[invoiceId];
      return updated;
    });
  };

  // Open pause/resume confirmation modal
  const openPauseModal = (invoice: InvoiceData, isPause: boolean) => {
    setPauseModal({ isOpen: true, invoice, isPause });
    setPauseReason('');
  };

  // Handle pause/resume confirmation
  const handlePauseConfirm = async () => {
    if (!pauseModal.invoice) return;

    setPauseLoading(true);
    try {
      // Call the parent handler - it will handle the API call
      onPauseInvoice(pauseModal.invoice, pauseModal.isPause);
      setPauseModal({ isOpen: false, invoice: null, isPause: true });
      setPauseReason('');
    } finally {
      setPauseLoading(false);
    }
  };

  // Close pause modal
  const closePauseModal = () => {
    setPauseModal({ isOpen: false, invoice: null, isPause: true });
    setPauseReason('');
  };

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

  // Check if any invoices are still loading their attempts
  const isLoadingAny = loadingAttempts.size > 0;
  const isRefreshingAny = refreshingId !== null;

  // Notify parent of loading state changes
  useEffect(() => {
    onUpdatingChange?.(isLoadingAny || isRefreshingAny);
  }, [isLoadingAny, isRefreshingAny, onUpdatingChange]);

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
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow hoverable={false}>
              <TableHead compact className="w-[32px]"></TableHead>
              <TableHead className="w-[90px]">Amount</TableHead>
              <TableHead className="w-[90px]">Date</TableHead>
              <TableHead className="hidden sm:table-cell"><span className="hidden sm:inline">Description</span></TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {failedInvoices.map((invoice) => {
              const isRefreshing = refreshingId === invoice.id;

              // Show skeleton row while refreshing
              if (isRefreshing) {
                return (
                  <TableRow key={invoice.id} className="bg-gray-50/50 animate-pulse">
                    <TableCell compact>
                      <div className="w-4 h-4 bg-gray-200 rounded" />
                    </TableCell>
                    <TableCell>
                      <div className="h-5 w-16 sm:w-20 bg-gray-200 rounded" />
                    </TableCell>
                    <TableCell>
                      <div className="h-5 w-20 sm:w-24 bg-gray-200 rounded" />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <div className="h-5 w-32 bg-gray-200 rounded" />
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex justify-end gap-2">
                        <div className="h-5 w-24 sm:w-32 bg-gray-200 rounded" />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              }

              const isExpanded = expandedId === invoice.id;
              const attempts = paymentAttempts[invoice.id] || [];
              const isLoadingAttempts = loadingAttempts.has(invoice.id);

              return (
                <>
                  <TableRow key={invoice.id} className={invoice.isPaused ? "bg-red-100/70" : "bg-red-50/50"}>
                    <TableCell compact>
                      <button
                        onClick={() => toggleExpanded(invoice.id)}
                        className="p-0.5 hover:bg-gray-100 rounded transition-colors"
                        title={isExpanded ? 'Hide details' : 'Show details'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      {editingAmount === invoice.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            ref={amountInputRef}
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleAmountKeyDown(e, invoice)}
                            onBlur={() => cancelEditAmount()}
                            className="w-16 sm:w-20 px-1.5 sm:px-2 py-0.5 sm:py-1 text-xs sm:text-sm border border-red-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                            disabled={savingAmount === invoice.id}
                          />
                          {savingAmount === invoice.id && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditAmount(invoice)}
                          className="text-left hover:bg-red-100 rounded px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors"
                          title="Click to edit amount"
                        >
                          <span className="font-semibold text-xs sm:text-sm text-red-700">
                            {formatCurrency(invoice.amount_due, invoice.currency)}
                          </span>
                          {invoice.amount_remaining > 0 && invoice.amount_remaining !== invoice.amount_due && (
                            <p className="text-[10px] sm:text-xs text-amber-600">
                              {formatCurrency(invoice.amount_remaining, invoice.currency)} <span className="hidden sm:inline">remaining</span>
                            </p>
                          )}
                        </button>
                      )}
                    </TableCell>

                    {/* Date Cell */}
                    <TableCell>
                      <div className="flex items-center gap-1 sm:gap-1.5 text-gray-600">
                        <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400" />
                        <span className="text-xs sm:text-sm">
                          {formatDate(getInvoiceDate(invoice))}
                        </span>
                      </div>
                    </TableCell>

                    {/* Error Message Cell - desktop only */}
                    <TableCell className="hidden sm:table-cell">
                      {(() => {
                        const errorInfo = getLatestError(invoice.id);
                        const errorMessage = errorInfo?.message || invoice.last_payment_error?.message;
                        const errorDate = errorInfo?.date;
                        const nextRetry = invoice.next_payment_attempt;

                        return (
                          <div className="flex items-start gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                            <div className="flex flex-col">
                              <span className="text-xs text-red-600 line-clamp-2">
                                {errorMessage || 'Payment failed'}
                              </span>
                              <div className="flex flex-wrap gap-x-2 mt-0.5">
                                {errorDate && (
                                  <span className="text-[10px] text-gray-400">
                                    Failed: {new Date(errorDate * 1000).toLocaleDateString()}
                                  </span>
                                )}
                                {invoice.isPaused ? (
                                  <span className="text-[10px] text-red-500 font-medium">
                                    Auto-retry stopped
                                  </span>
                                ) : nextRetry ? (
                                  <span className="text-[10px] text-amber-600">
                                    Next retry: {new Date(nextRetry * 1000).toLocaleDateString()}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </TableCell>

                    <TableCell align="right">
                      <>
                        {/* Desktop: action buttons with icons */}
                        <div className="hidden sm:flex items-center justify-end gap-1.5">
                          {editingAmount === invoice.id && (
                            <button
                              onMouseDown={(e) => {
                                e.preventDefault();
                                saveAmount(invoice);
                              }}
                              disabled={savingAmount === invoice.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors disabled:opacity-50"
                              title="Save Amount"
                            >
                              {savingAmount === invoice.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Save className="w-3.5 h-3.5" />
                              )}
                              Save
                            </button>
                          )}
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
                            title="Make Payment"
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            Make Payment
                          </button>
                          <button
                            onClick={() => openPauseModal(invoice, !invoice.isPaused)}
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
                            title="Void Payment"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Void
                          </button>
                          {/* Add Note button - always last, only show if no note exists */}
                          {!getDisplayedNote(invoice) && editingNote !== invoice.id && (
                            <button
                              onClick={() => startEditNote(invoice)}
                              className="inline-flex items-center gap-1 p-1 sm:px-2 sm:py-1 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                              title="Add note"
                            >
                              <StickyNote className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        {/* Mobile: compact icon buttons */}
                        <div className="sm:hidden flex items-center justify-end gap-1">
                          {editingAmount === invoice.id && (
                            <button
                              onMouseDown={(e) => {
                                e.preventDefault();
                                saveAmount(invoice);
                              }}
                              disabled={savingAmount === invoice.id}
                              className="p-1.5 text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors disabled:opacity-50"
                              title="Save Amount"
                            >
                              {savingAmount === invoice.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Save className="w-4 h-4" />
                              )}
                            </button>
                          )}
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
                            title="Make Payment"
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openPauseModal(invoice, !invoice.isPaused)}
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
                            title="Void Payment"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                          {/* Add Note button - always last, only show if no note exists */}
                          {!getDisplayedNote(invoice) && editingNote !== invoice.id && (
                            <button
                              onClick={() => startEditNote(invoice)}
                              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                              title="Add note"
                            >
                              <StickyNote className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </>
                    </TableCell>
                  </TableRow>
                  {/* Note Alert Row - only show if note exists or editing */}
                  {(() => {
                    const displayedNote = getDisplayedNote(invoice);
                    const originalNote = getInvoiceNote(invoice);
                    const noteChanged = pendingNotes[invoice.id] !== undefined &&
                      pendingNotes[invoice.id] !== originalNote;
                    const showNote = displayedNote || editingNote === invoice.id;

                    if (!showNote) return null;

                    return (
                      <tr key={`${invoice.id}-note`}>
                        <td colSpan={5} className="px-2 sm:px-3 py-1 border-b border-gray-100">
                          <div className={`flex items-center gap-2 px-2 py-1 rounded ${
                            noteChanged ? 'bg-amber-50 border border-amber-200' : 'bg-gray-100 border border-gray-200'
                          }`}>
                            <StickyNote className={`w-3.5 h-3.5 flex-shrink-0 ${noteChanged ? 'text-amber-600' : 'text-gray-400'}`} />
                            {editingNote === invoice.id ? (
                              <input
                                type="text"
                                value={noteEditValue}
                                onChange={(e) => handleNoteInputChange(invoice.id, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    closeNoteEditor();
                                    if (noteChanged) saveNoteOnly(invoice);
                                  } else if (e.key === 'Escape') {
                                    closeNoteEditor();
                                    cancelNoteOnly(invoice.id);
                                  }
                                }}
                                onBlur={() => closeNoteEditor()}
                                autoFocus
                                placeholder="Add a note..."
                                className="flex-1 text-xs bg-transparent border-none focus:outline-none focus:ring-0 p-0"
                              />
                            ) : (
                              <button
                                onClick={() => startEditNote(invoice)}
                                className="flex-1 text-left text-xs text-gray-600 hover:text-gray-800"
                              >
                                {displayedNote || 'Add a note...'}
                              </button>
                            )}
                            {noteChanged && (
                              <div className="flex items-center gap-1">
                                {savingNote === invoice.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                                ) : (
                                  <>
                                    <button
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        saveNoteOnly(invoice);
                                      }}
                                      className="p-0.5 text-green-600 hover:bg-green-100 rounded"
                                      title="Save note"
                                    >
                                      <Save className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        cancelNoteOnly(invoice.id);
                                        closeNoteEditor();
                                      }}
                                      className="p-0.5 text-gray-500 hover:bg-gray-200 rounded"
                                      title="Cancel"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })()}
                  {/* Expanded payment attempts section */}
                  {isExpanded && (
                    <tr key={`${invoice.id}-expanded`}>
                      <td colSpan={5} className="bg-gray-50 border-b border-gray-200">
                        <div className="px-4 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                              <Clock className="w-4 h-4" />
                              Payment Attempts
                              {attempts.length > 0 && ` (${attempts.length})`}
                            </h4>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => copyToClipboard(invoice.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded transition-colors"
                                title={`Copy Invoice ID: ${invoice.id}`}
                              >
                                {copiedId === invoice.id ? (
                                  <Check className="w-3.5 h-3.5 text-green-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                                <span className="hidden sm:inline">Copy ID</span>
                              </button>
                              <a
                                href={`https://dashboard.stripe.com/invoices/${invoice.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                                title="Open in Stripe"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Stripe</span>
                              </a>
                            </div>
                          </div>
                          {isLoadingAttempts ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                              <span className="ml-2 text-sm text-gray-500">Loading attempts...</span>
                            </div>
                          ) : attempts.length === 0 ? (
                            <div className="py-2">
                              <p className="text-sm text-gray-500">No payment attempt records found.</p>
                              <p className="text-xs text-gray-400 mt-1">
                                Stripe reports {invoice.attempt_count} attempt{invoice.attempt_count > 1 ? 's' : ''}, but detailed records may have expired (older than 30 days).
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {attempts.map((attempt) => (
                                <div
                                  key={attempt.id}
                                  className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg ${attempt.status === 'succeeded'
                                      ? 'bg-green-50 border border-green-200'
                                      : 'bg-red-50 border border-red-200'
                                    }`}
                                >
                                  <div className="flex items-start sm:items-center gap-3">
                                    <div className={`p-1.5 rounded-full ${attempt.status === 'succeeded' ? 'bg-green-100' : 'bg-red-100'
                                      }`}>
                                      {attempt.status === 'succeeded' ? (
                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                      ) : (
                                        <XCircle className="w-4 h-4 text-red-600" />
                                      )}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className={`text-sm font-medium ${attempt.status === 'succeeded' ? 'text-green-700' : 'text-red-700'
                                          }`}>
                                          {formatCurrency(attempt.amount, attempt.currency)}
                                        </span>
                                        {attempt.payment_method_details && (
                                          <span className="text-xs text-gray-500">
                                            <span className="capitalize">{attempt.payment_method_details.brand}</span>
                                            {' •••• '}
                                            {attempt.payment_method_details.last4}
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-xs text-gray-500 mt-0.5">
                                        {new Date(attempt.created * 1000).toLocaleString()}
                                      </div>
                                      {attempt.failure_message && (
                                        <div className="text-xs text-red-600 mt-1 flex items-start gap-1">
                                          <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                          <span>{attempt.failure_message}</span>
                                        </div>
                                      )}
                                      {attempt.outcome?.seller_message && !attempt.failure_message && (
                                        <div className="text-xs text-gray-600 mt-1">
                                          {attempt.outcome.seller_message}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-2 sm:mt-0 text-right">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${attempt.status === 'succeeded'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-red-100 text-red-700'
                                      }`}>
                                      {attempt.status === 'succeeded' ? 'Succeeded' : 'Failed'}
                                    </span>
                                    {attempt.failure_code && (
                                      <div className="text-[10px] text-gray-400 mt-1">
                                        Code: {attempt.failure_code}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      {/* Pause/Resume Confirmation Modal */}
      <Modal
        isOpen={pauseModal.isOpen}
        onClose={closePauseModal}
        title={pauseModal.invoice
          ? `${pauseModal.isPause ? 'Pause' : 'Resume'} Auto-retry: ${formatDate(getInvoiceDate(pauseModal.invoice))} - ${formatCurrency(pauseModal.invoice.amount_due, pauseModal.invoice.currency)}`
          : ''
        }
        size="md"
      >
        <div>
          {/* Warning/Info */}
          <div className={`${pauseModal.isPause ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'} rounded-xl p-4 mb-6 border`}>
            <div className="flex items-start gap-3">
              {pauseModal.isPause ? (
                <Pause className="w-5 h-5 text-amber-600 mt-0.5" />
              ) : (
                <Play className="w-5 h-5 text-green-600 mt-0.5" />
              )}
              <div>
                <p className={`font-medium ${pauseModal.isPause ? 'text-amber-800' : 'text-green-800'}`}>
                  {pauseModal.isPause
                    ? 'Are you sure you want to pause auto-retry?'
                    : 'Are you sure you want to resume auto-retry?'
                  }
                </p>
                <p className={`text-sm mt-1 ${pauseModal.isPause ? 'text-amber-600' : 'text-green-600'}`}>
                  {pauseModal.isPause
                    ? 'Stripe will stop automatically retrying this payment until you resume it.'
                    : 'Stripe will resume automatically retrying this payment.'
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Invoice Summary */}
          {pauseModal.invoice && (
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-500">Date</span>
                <span className="text-sm text-gray-700">
                  {formatDate(getInvoiceDate(pauseModal.invoice))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Amount</span>
                <span className="font-semibold text-gray-900">
                  {formatCurrency(pauseModal.invoice.amount_due, pauseModal.invoice.currency)}
                </span>
              </div>
            </div>
          )}

          {/* Reason (optional) */}
          <Textarea
            label="Reason (optional)"
            placeholder={`Why are you ${pauseModal.isPause ? 'pausing' : 'resuming'} this payment...`}
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            rows={3}
          />

          <ModalFooter>
            <Button variant="secondary" onClick={closePauseModal} disabled={pauseLoading}>
              Cancel
            </Button>
            <Button
              variant={pauseModal.isPause ? 'secondary' : 'primary'}
              onClick={handlePauseConfirm}
              loading={pauseLoading}
            >
              {pauseModal.isPause ? (
                <>
                  <Pause className="w-4 h-4" />
                  Pause Auto-retry
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Resume Auto-retry
                </>
              )}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </Card>
  );
}
