'use client';

import React, { useState } from 'react';
import { InvoiceData, PaymentData, PaymentMethodData, OtherPayment } from '@/types';
import { formatCurrency, formatDateTime, formatDate } from '@/lib/utils';
import {
  Card,
  CardHeader,
  CardContent,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Tooltip,
} from '@/components/ui';
import {
  FileText,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Check,
  ExternalLink,
  Hash,
  Calendar,
  Wallet,
  MessageSquare,
  RotateCcw,
  Clock,
  Undo2,
  Banknote,
  Copy,
  CreditCard,
  StickyNote,
  Loader2,
  Save,
  X,
} from 'lucide-react';

// Zelle SVG icon component
const ZelleIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M13.559 24h-2.841a.483.483 0 0 1-.483-.483v-5.317H3.188c-.307 0-.508-.043-.622-.131a.772.772 0 0 1-.248-.49.678.678 0 0 1 .087-.428c.075-.13.179-.277.313-.44l9.548-11.87H4.052a.56.56 0 0 1-.56-.56V.559c0-.309.251-.559.56-.559h8.613a.483.483 0 0 1 .483.483v5.334h7.047c.306 0 .507.043.621.13.114.088.195.243.248.49a.678.678 0 0 1-.087.427c-.075.131-.179.278-.313.44l-9.548 11.871h8.773a.56.56 0 0 1 .56.56v3.723a.56.56 0 0 1-.56.56h-5.33v.483a.483.483 0 0 1-.483.483l.043-.001Z" />
  </svg>
);

// Helper to get payment type icon
const getPaymentTypeIcon = (paymentType: string, className?: string) => {
  const type = paymentType.toLowerCase();
  if (type === 'zelle') {
    return <ZelleIcon className={className || "w-4 h-4 text-purple-600"} />;
  } else if (type === 'cash') {
    return <Banknote className={className || "w-4 h-4 text-green-600"} />;
  } else if (type === 'check') {
    return <FileText className={className || "w-4 h-4 text-blue-600"} />;
  }
  // Default to banknote for other types
  return <Banknote className={className || "w-4 h-4 text-amber-600"} />;
};

interface SuccessfulPaymentsTableProps {
  invoices: InvoiceData[];
  payments: PaymentData[];
  paymentMethods?: PaymentMethodData[];
  otherPayments?: OtherPayment[];
  onRefund: (payment: PaymentData) => void;
  onRefresh?: () => void;
  token?: string;
  accountId?: string;
}

export function SuccessfulPaymentsTable({
  invoices,
  payments,
  otherPayments,
  onRefund,
  onRefresh,
  token,
  accountId,
}: SuccessfulPaymentsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Inline note editing state
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteEditValue, setNoteEditValue] = useState('');
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<string | null>(null);

  const copyToClipboard = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const succeededPayments = payments
    .filter(p => p.status === 'succeeded')
    .sort((a, b) => b.created - a.created);

  // Sort other payments by date (newest first)
  const sortedOtherPayments = (otherPayments || [])
    .map(p => ({
      ...p,
      timestamp: new Date(p.paymentDate).getTime() / 1000,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  const toggleExpanded = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // Helper to get payment invoice info from metadata
  const getPaymentInvoiceInfo = (payment: PaymentData) => {
    const invoiceIds = payment.metadata?.invoicesPaid?.split(',').filter(Boolean) || [];
    const invoiceNumbers = payment.metadata?.invoiceNumbersPaid?.split(',').filter(Boolean) || [];
    const invoiceAmounts = payment.metadata?.invoiceAmounts?.split(',').filter(Boolean).map(a => parseInt(a, 10)) || [];
    const totalApplied = parseInt(payment.metadata?.totalAppliedToInvoices || '0', 10);
    const creditAdded = parseInt(payment.metadata?.creditAdded || '0', 10);
    const reason = payment.metadata?.reason || payment.metadata?.lastPaymentReason;
    const invoiceUID = payment.metadata?.InvoiceUID;
    return { invoiceIds, invoiceNumbers, invoiceAmounts, totalApplied, creditAdded, reason, invoiceUID };
  };

  // Get payment note from metadata
  const getPaymentNote = (payment: PaymentData): string => {
    return payment.metadata?.note || '';
  };

  // Get displayed note (pending or original)
  const getDisplayedNote = (payment: PaymentData): string => {
    if (pendingNotes[payment.id] !== undefined) return pendingNotes[payment.id];
    return getPaymentNote(payment);
  };

  // Start editing note
  const startEditNote = (payment: PaymentData) => {
    setNoteEditValue(getDisplayedNote(payment));
    setEditingNote(payment.id);
  };

  // Handle note input change
  const handleNoteInputChange = (paymentId: string, newValue: string) => {
    setNoteEditValue(newValue);
    setPendingNotes(prev => ({ ...prev, [paymentId]: newValue }));
  };

  // Close note editor
  const closeNoteEditor = () => {
    setEditingNote(null);
    setNoteEditValue('');
  };

  // Save note for a payment
  const saveNoteOnly = async (payment: PaymentData) => {
    const pendingNote = pendingNotes[payment.id];
    if (pendingNote === undefined || pendingNote === getPaymentNote(payment)) return;

    // Skip saving for virtual IDs (out-of-band payments)
    if (payment.id.startsWith('inv_paid_')) {
      setPendingNotes(prev => {
        const updated = { ...prev };
        delete updated[payment.id];
        return updated;
      });
      return;
    }

    setSavingNote(payment.id);
    try {
      let url = '/api/stripe/payments';
      if (token) {
        url += `?token=${encodeURIComponent(token)}`;
      }

      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId: payment.id,
          note: pendingNote.trim(),
          accountId,
        }),
      });

      if (response.ok) {
        setPendingNotes(prev => {
          const updated = { ...prev };
          delete updated[payment.id];
          return updated;
        });
        onRefresh?.();
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
  const cancelNoteOnly = (paymentId: string) => {
    setPendingNotes(prev => {
      const updated = { ...prev };
      delete updated[paymentId];
      return updated;
    });
  };

  const totalPaymentsCount = succeededPayments.length + sortedOtherPayments.length;

  if (totalPaymentsCount === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-gray-400" />
            Successful Payments
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No successful payments
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
            {totalPaymentsCount} payment{totalPaymentsCount !== 1 ? 's' : ''}
          </span>
        }
      >
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          Successful Payments
        </div>
      </CardHeader>
      <CardContent noPadding>
        <div className="overflow-x-auto">
          <table className="w-full">
          <TableHeader>
            <TableRow hoverable={false}>
              <th className="p-0"></th>
              <TableHead compact>Amount</TableHead>
              <TableHead compact>Card</TableHead>
              <TableHead compact>Date</TableHead>
              <TableHead align="right" compact>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {succeededPayments.map((payment) => {
              const isExpanded = expandedId === `pay-${payment.id}`;
              const invoiceInfo = getPaymentInvoiceInfo(payment);

              return (
                <React.Fragment key={payment.id}>
                  <TableRow className={payment.amount_refunded > 0 ? 'bg-gray-50/50' : ''}>
                    <td className="p-0">
                      <button
                        onClick={() => toggleExpanded(`pay-${payment.id}`)}
                        className="w-4 h-4 flex items-center justify-center hover:bg-gray-100 rounded transition-colors"
                        title={isExpanded ? 'Hide details' : 'Show details'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-gray-400" />
                        )}
                      </button>
                    </td>
                    <TableCell compact>
                      <div>
                        {payment.amount_refunded > 0 ? (
                          <div className="inline-flex flex-col items-start gap-0.5 font-mono text-xs sm:text-sm">
                            {/* Original amount */}
                            <span className="text-gray-500">
                              {formatCurrency(payment.amount, payment.currency)}
                            </span>
                            {/* Refund line */}
                            <span className="text-red-500 flex items-center gap-0.5 sm:gap-1">
                              <span className="text-[10px] sm:text-xs">−</span>
                              {formatCurrency(payment.amount_refunded, payment.currency)}
                            </span>
                            {/* Divider line */}
                            <span className="w-full border-t border-gray-300 my-0.5"></span>
                            {/* Net amount */}
                            <span className={`font-semibold ${payment.amount_refunded >= payment.amount ? 'text-gray-400' : 'text-green-600'}`}>
                              {formatCurrency(payment.amount - payment.amount_refunded, payment.currency)}
                            </span>
                          </div>
                        ) : (
                          <span className="font-semibold text-green-600 text-xs sm:text-sm">
                            {formatCurrency(payment.amount, payment.currency)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell compact>
                      {payment.payment_method?.card ? (
                        <div className="flex items-center gap-1.5">
                          <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                          <div className="text-xs">
                            <span className="text-gray-700 capitalize">{payment.payment_method.card.brand}</span>
                            <span className="text-gray-400 ml-1">•••• {payment.payment_method.card.last4}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell compact>
                      <div>
                        <span className="text-gray-600 text-xs sm:text-sm">
                          {formatDateTime(payment.created)}
                        </span>
                        {payment.amount_refunded > 0 && payment.refund_reason && (
                          <p className="text-[10px] sm:text-xs text-gray-500 capitalize mt-0.5 hidden sm:block">
                            {payment.refund_reason.replace(/_/g, ' ')}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell align="right" compact>
                      <div className="flex items-center justify-end gap-1">
                        {payment.status === 'succeeded' && payment.amount_refunded < payment.amount ? (
                          <>
                            <Tooltip content="Refund Payment">
                              <button
                                onClick={() => onRefund(payment)}
                                className="inline-flex items-center justify-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Refund</span>
                              </button>
                            </Tooltip>
                            {payment.amount_refunded > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[12px] text-red-600 bg-red-50 rounded font-medium">
                                <RotateCcw className="w-2.5 h-2.5" />
                                Partial refund
                              </span>
                            )}
                          </>
                        ) : payment.amount_refunded >= payment.amount ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] sm:text-xs text-red-500 bg-red-50 rounded-md font-medium">
                            <Check className="w-3 h-3" />
                            <span className="hidden sm:inline">Fully </span>Refunded
                          </span>
                        ) : null}
                        {/* Add Note button - always last, only show if no note exists */}
                        {!getDisplayedNote(payment) && editingNote !== payment.id && (
                          <Tooltip content="Add note">
                            <button
                              onClick={() => startEditNote(payment)}
                              className="flex items-center justify-center p-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                            >
                              <StickyNote className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Note Alert Row - only show if note exists or editing */}
                  {(() => {
                    const displayedNote = getDisplayedNote(payment);
                    const originalNote = getPaymentNote(payment);
                    const noteChanged = pendingNotes[payment.id] !== undefined &&
                      pendingNotes[payment.id] !== originalNote;
                    const showNote = displayedNote || editingNote === payment.id;

                    if (!showNote) return null;

                    return (
                      <tr key={`${payment.id}-note`}>
                        <td colSpan={100} className="px-2 sm:px-3 py-1 border-b border-gray-100">
                          <div className={`flex items-center gap-2 px-2 py-1 rounded ${
                            noteChanged ? 'bg-amber-50 border border-amber-200' : 'bg-gray-100 border border-gray-200'
                          }`}>
                            <StickyNote className={`w-3 h-3 flex-shrink-0 ${noteChanged ? 'text-amber-500' : 'text-gray-400'}`} />
                            {editingNote === payment.id ? (
                              <input
                                type="text"
                                value={noteEditValue}
                                onChange={(e) => handleNoteInputChange(payment.id, e.target.value)}
                                onBlur={() => closeNoteEditor()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === 'Escape') {
                                    closeNoteEditor();
                                  }
                                }}
                                autoFocus
                                placeholder="Add a note..."
                                className="flex-1 text-xs text-gray-700 bg-white border border-gray-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            ) : (
                              <button
                                onClick={() => startEditNote(payment)}
                                className={`flex-1 text-left text-xs hover:underline ${
                                  noteChanged ? 'text-amber-700' : 'text-gray-600'
                                }`}
                              >
                                {displayedNote}
                              </button>
                            )}
                            {noteChanged && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onClick={() => saveNoteOnly(payment)}
                                  disabled={savingNote === payment.id}
                                  className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] rounded transition-colors disabled:opacity-50"
                                >
                                  {savingNote === payment.id ? (
                                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  ) : (
                                    <Save className="w-2.5 h-2.5" />
                                  )}
                                  Save
                                </button>
                                <button
                                  onClick={() => cancelNoteOnly(payment.id)}
                                  disabled={savingNote === payment.id}
                                  className="p-0.5 hover:bg-gray-200 text-gray-500 rounded transition-colors"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })()}

                  {/* Expanded Details */}
                  {isExpanded && (
                    <tr key={`${payment.id}-details`}>
                      <td colSpan={100} className="bg-gray-50 px-4 py-3 border-b">
                        {/* Header with copy and external link buttons */}
                        <div className="flex items-center justify-end gap-2 mb-3">
                          <button
                            onClick={() => copyToClipboard(payment.id.startsWith('inv_paid_') && payment.invoice ? payment.invoice! : payment.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded transition-colors"
                            title={`Copy ${payment.id.startsWith('inv_paid_') ? 'Payment' : 'Payment'} ID`}
                          >
                            {copiedId === (payment.id.startsWith('inv_paid_') && payment.invoice ? payment.invoice : payment.id) ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span className="hidden sm:inline">Copy ID</span>
                          </button>
                          <a
                            href={payment.id.startsWith('inv_paid_') && payment.invoice
                              ? `https://dashboard.stripe.com/invoices/${payment.invoice}`
                              : `https://dashboard.stripe.com/payments/${payment.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                            title="Open in Stripe"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Stripe</span>
                          </a>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                          {/* Payment Intent ID or Invoice ID for out-of-band */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                              <Hash className="w-3 h-3" />
                              {payment.id.startsWith('inv_paid_') ? 'Payment (Paid Out-of-Band)' : 'Payment Intent'}
                            </div>
                            <span className="font-mono text-xs text-gray-700">
                              {payment.id.startsWith('inv_paid_') ? payment.invoice : payment.id}
                            </span>
                          </div>

                          {/* Payment Date */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                              <Calendar className="w-3 h-3" />
                              Payment Date
                            </div>
                            <p className="text-gray-700">{formatDateTime(payment.created)}</p>
                          </div>

                          {/* PaymentUID */}
                          {invoiceInfo.invoiceUID && (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                <Hash className="w-3 h-3" />
                                Payment UID
                              </div>
                              <p className="font-mono text-xs text-gray-700">{invoiceInfo.invoiceUID}</p>
                            </div>
                          )}




                          {/* Payments via PayNow */}
                          {invoiceInfo.invoiceIds.length > 0 && (
                            <div className="space-y-2 col-span-full">
                              <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                <FileText className="w-3 h-3" />
                                Payments ({invoiceInfo.invoiceIds.length})
                              </div>
                              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                                {invoiceInfo.invoiceIds.map((id, idx) => {
                                  const invoice = invoices.find(inv => inv.id === id);
                                  // Use stored amount from metadata if invoice is deleted
                                  const storedAmount = invoiceInfo.invoiceAmounts[idx];

                                  // Get the date - either finalize date for draft or due_date for others
                                  const getInvoiceDate = (inv: InvoiceData | undefined) => {
                                    if (!inv) return null;
                                    // Check metadata first (custom scheduled date)
                                    if (inv.metadata?.scheduledFinalizeAt) {
                                      return parseInt(inv.metadata.scheduledFinalizeAt, 10);
                                    }
                                    // Then check automatically_finalizes_at for draft invoices
                                    if (inv.automatically_finalizes_at) {
                                      return inv.automatically_finalizes_at;
                                    }
                                    // Finally due_date
                                    return inv.due_date;
                                  };

                                  const invoiceDate = invoice ? getInvoiceDate(invoice) : null;
                                  const isFutureDate = invoiceDate && invoiceDate > Math.floor(Date.now() / 1000);

                                  // Determine the amount to display
                                  const displayAmount = invoice
                                    ? formatCurrency(invoice.amount_due, invoice.currency)
                                    : storedAmount
                                      ? formatCurrency(storedAmount, payment.currency)
                                      : '-';

                                  return (
                                    <div key={id} className="flex items-center justify-between px-3 py-2">
                                      <span className="font-semibold text-sm text-gray-900">
                                        {displayAmount}
                                      </span>
                                      {invoiceDate && (
                                        <span className={`flex items-center gap-1 text-xs ${isFutureDate ? 'text-indigo-600' : 'text-gray-500'}`}>
                                          {isFutureDate ? <Clock className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
                                          {formatDate(invoiceDate)}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              {invoiceInfo.totalApplied > 0 && (
                                <p className="text-xs text-gray-500">
                                  Total applied: {formatCurrency(invoiceInfo.totalApplied, payment.currency)}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Credit added */}
                          {invoiceInfo.creditAdded > 0 && (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                <Wallet className="w-3 h-3" />
                                Credit Added
                              </div>
                              <p className="font-medium text-amber-600">
                                {formatCurrency(invoiceInfo.creditAdded, payment.currency)}
                              </p>
                            </div>
                          )}

                          {/* Reason/Note */}
                          {invoiceInfo.reason && (
                            <div className="space-y-1 col-span-full">
                              <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                <MessageSquare className="w-3 h-3" />
                                Payment Note
                              </div>
                              <p className="text-gray-700 italic">{invoiceInfo.reason}</p>
                            </div>
                          )}

                          {/* Refund info if refunded */}
                          {payment.refunded && payment.amount_refunded > 0 && (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 text-indigo-500 text-xs font-medium uppercase">
                                <RotateCcw className="w-3 h-3" />
                                Refund Amount
                              </div>
                              <p className="font-medium text-indigo-600">
                                {formatCurrency(payment.amount_refunded, payment.currency)}
                              </p>
                              {payment.refund_reason && (
                                <p className="text-xs text-gray-500">Reason: {payment.refund_reason}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}

            {/* Other Payments (Zelle, Cash, etc.) - No action buttons */}
            {sortedOtherPayments.map((payment, index) => {
              const paymentDate = new Date(payment.paymentDate);
              const isExpanded = expandedId === `other-${index}`;
              const isZelle = payment.paymentType.toLowerCase() === 'zelle';
              const isCash = payment.paymentType.toLowerCase() === 'cash';

              return (
                <React.Fragment key={`other-${index}`}>
                  <TableRow className={isZelle ? "bg-purple-50/30" : isCash ? "bg-green-50/30" : "bg-amber-50/30"}>
                    <td className="p-0">
                      <button
                        onClick={() => toggleExpanded(`other-${index}`)}
                        className="w-4 h-4 flex items-center justify-center hover:bg-gray-100 rounded transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-gray-400" />
                        )}
                      </button>
                    </td>
                    <TableCell compact>
                      <span className="font-semibold text-green-600 text-xs sm:text-sm">
                        {formatCurrency(payment.amount * 100, 'usd')}
                      </span>
                    </TableCell>
                    <TableCell compact>
                      <span className={`inline-flex items-center gap-1 text-xs ${
                        isZelle
                          ? 'text-purple-600'
                          : isCash
                            ? 'text-green-600'
                            : 'text-amber-600'
                      }`}>
                        {getPaymentTypeIcon(payment.paymentType, "w-3.5 h-3.5")}
                        <span className="capitalize">{payment.paymentType}</span>
                      </span>
                    </TableCell>
                    <TableCell compact>
                      <div>
                        <span className="text-gray-600 text-xs sm:text-sm">
                          {paymentDate.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell align="right" compact>
                      <span className="text-gray-400 text-xs">-</span>
                    </TableCell>
                  </TableRow>

                  {/* Description row for other payments */}
                  {payment.description && (
                    <tr key={`other-${index}-desc`}>
                      <td colSpan={100} className={`px-2 sm:px-3 py-1 border-b border-gray-100 ${isZelle ? 'bg-purple-50/30' : isCash ? 'bg-green-50/30' : 'bg-amber-50/30'}`}>
                        <p className="text-[10px] sm:text-xs text-gray-500">
                          {payment.description}
                        </p>
                      </td>
                    </tr>
                  )}

                  {/* Expanded Details for Other Payments */}
                  {isExpanded && (
                    <tr key={`other-${index}-details`}>
                      <td colSpan={100} className={`px-4 py-3 border-b ${isZelle ? 'bg-purple-50' : isCash ? 'bg-green-50' : 'bg-amber-50'}`}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          {/* Payment Type */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                              <Wallet className="w-3 h-3" />
                              Payment Method
                            </div>
                            <p className={`font-medium flex items-center gap-1.5 ${isZelle ? 'text-purple-700' : isCash ? 'text-green-700' : 'text-amber-700'}`}>
                              {getPaymentTypeIcon(payment.paymentType, "w-4 h-4")}
                              {payment.paymentType}
                            </p>
                          </div>

                          {/* Payment Date */}
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                              <Calendar className="w-3 h-3" />
                              Payment Date
                            </div>
                            <p className="text-gray-700">
                              {paymentDate.toLocaleDateString('en-US', {
                                weekday: 'long',
                                month: 'long',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </p>
                          </div>

                          {/* Description */}
                          {payment.description && (
                            <div className="space-y-1 col-span-full">
                              <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                <MessageSquare className="w-3 h-3" />
                                Description
                              </div>
                              <p className="text-gray-700">{payment.description}</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </table>
        </div>
      </CardContent>
    </Card>
  );
}
