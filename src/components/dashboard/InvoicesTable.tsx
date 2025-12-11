'use client';

import { InvoiceData, PaymentMethodData } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Card,
  CardHeader,
  CardContent,
  Button,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
} from '@/components/ui';
import {
  FileText,
  ExternalLink,
  Download,
  Play,
  Pause,
  CreditCard,
  XCircle,
  Edit3,
  Receipt,
  Mail,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Repeat,
  Trash2,
  Copy,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { useState } from 'react';

interface InvoicesTableProps {
  invoices: InvoiceData[];
  paymentMethods?: PaymentMethodData[];
  onPayInvoice: (invoice: InvoiceData) => void;
  onVoidInvoice: (invoice: InvoiceData) => void;
  onPauseInvoice: (invoice: InvoiceData, pause: boolean) => void;
  onAdjustInvoice: (invoice: InvoiceData) => void;
  onRetryInvoice: (invoice: InvoiceData) => void;
  onChangePaymentMethod?: (invoice: InvoiceData) => void;
  onSendReminder?: (invoice: InvoiceData) => void;
  onDeleteInvoice?: (invoice: InvoiceData) => void;
  loading?: boolean;
}

// Sort order: Failed (open with payment issues) -> Paid -> Draft
const getInvoiceSortPriority = (invoice: InvoiceData): number => {
  // Failed invoices (open with remaining amount) - highest priority
  if (invoice.status === 'open' && invoice.amount_remaining > 0) return 0;
  // Paid invoices
  if (invoice.status === 'paid') return 1;
  // Draft/future invoices - lowest priority
  if (invoice.status === 'draft') return 2;
  // Other statuses (void, uncollectible)
  return 3;
};

export function InvoicesTable({
  invoices,
  paymentMethods = [],
  onPayInvoice,
  onVoidInvoice,
  onPauseInvoice,
  onAdjustInvoice,
  onRetryInvoice,
  onChangePaymentMethod,
  onSendReminder,
  onDeleteInvoice,
  loading,
}: InvoicesTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create a map for quick payment method lookup
  const paymentMethodMap = new Map(paymentMethods.map(pm => [pm.id, pm]));

  // Sort invoices: Failed -> Paid -> Draft, then by date
  const sortedInvoices = [...invoices].sort((a, b) => {
    const priorityDiff = getInvoiceSortPriority(a) - getInvoiceSortPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    // Within same priority, sort by due date (soonest first) or created date
    return (b.due_date || b.created) - (a.due_date || a.created);
  });

  // Filter to show only the latest draft invoice
  const filteredInvoices = sortedInvoices.filter((invoice, index, arr) => {
    // Keep all non-draft invoices
    if (invoice.status !== 'draft') return true;
    // For drafts, only keep the first one (latest by sort order)
    const firstDraftIndex = arr.findIndex(inv => inv.status === 'draft');
    return index === firstDraftIndex;
  });

  // Helper to copy payment link
  const copyPaymentLink = (url: string) => {
    navigator.clipboard.writeText(url);
  };

  const getStatusVariant = (invoice: InvoiceData) => {
    if (invoice.isPaused) return 'paused';
    // Show "failed" status for open invoices with remaining balance and payment attempts
    if (invoice.status === 'open' && invoice.amount_remaining > 0 && invoice.attempt_count > 0) {
      return 'failed';
    }
    return invoice.status || 'draft';
  };

  const toggleExpanded = (invoiceId: string) => {
    setExpandedId(expandedId === invoiceId ? null : invoiceId);
  };

  return (
    <Card>
      <CardHeader action={
        <span className="text-sm text-gray-500">
          {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
        </span>
      }>
        <div className="flex items-center gap-2">
          <Receipt className="w-5 h-5 text-indigo-600" />
          Invoices
        </div>
      </CardHeader>
      <CardContent noPadding>
        <Table>
          <TableHeader>
            <TableRow hoverable={false}>
              <TableHead>{' '}</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment Method</TableHead>
              <TableHead align="right">Amount</TableHead>
              <TableHead align="right">Paid</TableHead>
              <TableHead align="right">Remaining</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvoices.length === 0 ? (
              <TableEmptyState
                message="No invoices found"
                icon={<FileText className="w-12 h-12" />}
              />
            ) : (
              filteredInvoices.map((invoice) => (
                <>
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <button
                        onClick={() => toggleExpanded(invoice.id)}
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                      >
                        {expandedId === invoice.id ? (
                          <ChevronUp className="w-4 h-4 text-gray-500" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-500" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-gray-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-1">
                            <p className="font-medium text-gray-900">
                              {invoice.number || invoice.id.slice(0, 12)}
                            </p>
                            <a
                              href={`https://dashboard.stripe.com/invoices/${invoice.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-0.5 hover:bg-gray-100 rounded transition-colors"
                              title="Open in Stripe"
                            >
                              <ExternalLink className="w-3 h-3 text-gray-400 hover:text-indigo-600" />
                            </a>
                          </div>
                          <p className="text-xs text-gray-500">
                            {formatDate(invoice.created)}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge status={getStatusVariant(invoice)} />
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const pm = invoice.default_payment_method
                          ? paymentMethodMap.get(invoice.default_payment_method)
                          : null;
                        if (pm?.card) {
                          return (
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-5 rounded bg-gray-100 flex items-center justify-center">
                                <CreditCard className="w-3.5 h-3.5 text-gray-500" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900 capitalize">
                                  {pm.card.brand}
                                </p>
                                <p className="text-xs text-gray-500">
                                  •••• {pm.card.last4}
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return <span className="text-gray-400 text-sm">-</span>;
                      })()}
                    </TableCell>
                    <TableCell align="right">
                      <span className="font-semibold text-gray-900">
                        {formatCurrency(invoice.amount_due, invoice.currency)}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      {(() => {
                        const metadataTotalPaid = invoice.metadata?.totalPaid
                          ? parseInt(invoice.metadata.totalPaid)
                          : 0;
                        const effectivePaid = invoice.status === 'draft'
                          ? metadataTotalPaid
                          : invoice.amount_paid;
                        return (
                          <span className="text-green-600">
                            {formatCurrency(effectivePaid, invoice.currency)}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell align="right">
                      {(() => {
                        const metadataTotalPaid = invoice.metadata?.totalPaid
                          ? parseInt(invoice.metadata.totalPaid)
                          : 0;
                        const effectiveRemaining = invoice.status === 'draft'
                          ? Math.max(0, invoice.amount_due - metadataTotalPaid)
                          : invoice.amount_remaining;
                        return (
                          <span className={effectiveRemaining > 0 ? 'text-amber-600 font-medium' : 'text-gray-500'}>
                            {formatCurrency(effectiveRemaining, invoice.currency)}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {invoice.due_date ? formatDate(invoice.due_date) : '-'}
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Pay Button - for open and draft invoices */}
                        {(invoice.status === 'open' || invoice.status === 'draft') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onPayInvoice(invoice)}
                            title="Pay Invoice"
                          >
                            <CreditCard className="w-4 h-4" />
                          </Button>
                        )}

                        {/* Retry Button - for open invoices (failed payment) */}
                        {invoice.status === 'open' && invoice.amount_remaining > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRetryInvoice(invoice)}
                            title="Retry Payment"
                          >
                            <RefreshCw className="w-4 h-4 text-orange-600" />
                          </Button>
                        )}

                        {/* Send Reminder - for open invoices with remaining balance */}
                        {invoice.status === 'open' && invoice.amount_remaining > 0 && onSendReminder && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onSendReminder(invoice)}
                            title="Send Reminder Email"
                          >
                            <Mail className="w-4 h-4 text-blue-600" />
                          </Button>
                        )}

                        {/* Copy Payment Link - for open invoices */}
                        {invoice.status === 'open' && invoice.hosted_invoice_url && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyPaymentLink(invoice.hosted_invoice_url!)}
                            title="Copy Payment Link"
                          >
                            <Copy className="w-4 h-4 text-gray-500" />
                          </Button>
                        )}

                        {/* Pause/Resume Button - for open and draft invoices */}
                        {(invoice.status === 'open' || invoice.status === 'draft') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onPauseInvoice(invoice, !invoice.isPaused)}
                            title={invoice.isPaused ? 'Resume Auto-payment' : 'Pause Auto-payment'}
                          >
                            {invoice.isPaused ? (
                              <Play className="w-4 h-4 text-green-600" />
                            ) : (
                              <Pause className="w-4 h-4 text-amber-600" />
                            )}
                          </Button>
                        )}

                        {/* Adjust Button - only for draft invoices */}
                        {invoice.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onAdjustInvoice(invoice)}
                            title="Adjust Amount"
                          >
                            <Edit3 className="w-4 h-4" />
                          </Button>
                        )}

                        {/* Change Payment Method - for draft and open invoices */}
                        {(invoice.status === 'draft' || invoice.status === 'open') && onChangePaymentMethod && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onChangePaymentMethod(invoice)}
                            title="Change Payment Method"
                          >
                            <Repeat className="w-4 h-4 text-indigo-600" />
                          </Button>
                        )}

                        {/* Delete Button - only for draft invoices */}
                        {invoice.status === 'draft' && onDeleteInvoice && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDeleteInvoice(invoice)}
                            title="Delete Invoice"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        )}

                        {/* Void Button - only for open invoices */}
                        {invoice.status === 'open' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onVoidInvoice(invoice)}
                            title="Void Invoice"
                          >
                            <XCircle className="w-4 h-4 text-red-500" />
                          </Button>
                        )}

                        {/* View Invoice */}
                        {invoice.hosted_invoice_url && (
                          <a
                            href={invoice.hosted_invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title="View Invoice"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}

                        {/* Download PDF */}
                        {invoice.pdf && (
                          <a
                            href={invoice.pdf}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Download PDF"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {/* Expanded Details Row */}
                  {expandedId === invoice.id && (
                    <tr key={`${invoice.id}-details`}>
                      <td colSpan={9} className="bg-gray-50 px-6 py-4 border-b">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {/* Invoice ID */}
                          <div>
                            <p className="text-xs font-medium text-gray-500 uppercase">Invoice ID</p>
                            <p className="text-sm text-gray-900 font-mono">{invoice.id}</p>
                          </div>

                          {/* Payment Failure Info - for failed invoices */}
                          {invoice.status === 'open' && invoice.amount_remaining > 0 && (invoice.last_payment_error || invoice.attempt_count > 0) && (
                            <div className="col-span-2">
                              <p className="text-xs font-medium text-red-600 uppercase">Payment Failed</p>
                              <div className="bg-red-50 rounded-lg p-3 mt-1 border border-red-200">
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                  <div className="space-y-1">
                                    {invoice.last_payment_error?.message && (
                                      <p className="text-sm text-red-700">{invoice.last_payment_error.message}</p>
                                    )}
                                    {invoice.last_payment_error?.decline_code && (
                                      <p className="text-xs text-red-600">
                                        Decline code: <span className="font-mono">{invoice.last_payment_error.decline_code}</span>
                                      </p>
                                    )}
                                    {invoice.attempt_count > 0 && (
                                      <p className="text-xs text-gray-600">
                                        Payment attempts: {invoice.attempt_count}
                                      </p>
                                    )}
                                    {invoice.next_payment_attempt && (
                                      <div className="flex items-center gap-1 text-xs text-gray-600 mt-2">
                                        <Clock className="w-3 h-3" />
                                        Next retry: {formatDate(invoice.next_payment_attempt)}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Description */}
                          {invoice.description && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase">Description</p>
                              <p className="text-sm text-gray-900">{invoice.description}</p>
                            </div>
                          )}

                          {/* Adjustment Info */}
                          {invoice.adjustmentNote && (
                            <div className="col-span-2">
                              <p className="text-xs font-medium text-amber-600 uppercase">Adjustment</p>
                              <div className="text-sm text-gray-900 bg-amber-50 rounded-lg p-2 mt-1">
                                <p className="font-medium">{invoice.adjustmentNote}</p>
                                {invoice.metadata?.originalAmount && (
                                  <p className="text-xs text-gray-500 mt-1">
                                    Original amount: {formatCurrency(parseInt(invoice.metadata.originalAmount), invoice.currency)}
                                    {' → '}
                                    New amount: {formatCurrency(invoice.amount_due, invoice.currency)}
                                    {' ('}
                                    {invoice.amount_due < parseInt(invoice.metadata.originalAmount) ? '-' : '+'}
                                    {formatCurrency(Math.abs(invoice.amount_due - parseInt(invoice.metadata.originalAmount)), invoice.currency)}
                                    {')'}
                                  </p>
                                )}
                                {invoice.metadata?.adjustedAt && (
                                  <p className="text-xs text-gray-400 mt-1">
                                    Adjusted on {formatDate(parseInt(invoice.metadata.adjustedAt) / 1000)}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Partial Payment Info */}
                          {invoice.metadata?.partialPaymentAmount && (
                            <div className="col-span-2">
                              <p className="text-xs font-medium text-green-600 uppercase">Partial Payment</p>
                              <div className="text-sm text-gray-900 bg-green-50 rounded-lg p-2 mt-1">
                                <p>
                                  Partial payment of {formatCurrency(parseInt(invoice.metadata.partialPaymentAmount), invoice.currency)} received
                                </p>
                                {invoice.metadata?.partialPaymentDate && (
                                  <p className="text-xs text-gray-500 mt-1">
                                    On {formatDate(parseInt(invoice.metadata.partialPaymentDate) / 1000)}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Payment History */}
                          {invoice.metadata?.paymentHistory && (
                            <div className="col-span-full">
                              <p className="text-xs font-medium text-green-600 uppercase mb-2">Payment History</p>
                              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                                {(() => {
                                  try {
                                    const payments = JSON.parse(invoice.metadata.paymentHistory) as Array<{
                                      amount: number;
                                      reason: string;
                                      date: number;
                                      type: string;
                                      paymentIntentId?: string;
                                      creditTransactionId?: string;
                                    }>;
                                    return payments.map((payment, idx) => (
                                      <div key={idx} className="flex justify-between items-center px-3 py-2">
                                        <div>
                                          <span className="text-sm text-gray-700">
                                            {payment.type === 'credit' ? '💳 Credit' : '💵 Payment'}
                                          </span>
                                          <span className="text-xs text-gray-500 ml-2">
                                            {payment.reason}
                                          </span>
                                          <p className="text-xs text-gray-400">
                                            {formatDate(payment.date / 1000)}
                                          </p>
                                        </div>
                                        <span className="text-sm font-medium text-green-600">
                                          +{formatCurrency(payment.amount, invoice.currency)}
                                        </span>
                                      </div>
                                    ));
                                  } catch {
                                    return <p className="text-sm text-gray-500 p-2">Unable to parse payment history</p>;
                                  }
                                })()}
                              </div>
                            </div>
                          )}

                          {/* Paused Info */}
                          {invoice.isPaused && (
                            <div>
                              <p className="text-xs font-medium text-amber-600 uppercase">Status</p>
                              <div className="text-sm text-amber-700 bg-amber-50 rounded-lg p-2 mt-1">
                                Auto-payment paused
                                {invoice.originalDueDate && (
                                  <p className="text-xs text-gray-500">
                                    Original due: {formatDate(invoice.originalDueDate)}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Line Items */}
                          {invoice.lines && invoice.lines.length > 0 && (
                            <div className="col-span-full">
                              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Line Items</p>
                              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                                {invoice.lines.map((line) => (
                                  <div key={line.id} className="flex justify-between items-center px-3 py-2">
                                    <span className="text-sm text-gray-700">
                                      {line.description || 'Invoice item'}
                                      {line.quantity && line.quantity > 1 && (
                                        <span className="text-gray-400 ml-1">x{line.quantity}</span>
                                      )}
                                    </span>
                                    <span className="text-sm font-medium text-gray-900">
                                      {formatCurrency(line.amount, line.currency)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Metadata */}
                          {Object.keys(invoice.metadata || {}).filter(k =>
                            !['isPaused', 'originalDueDate', 'adjustmentNote', 'originalAmount', 'adjustedAt', 'partialPaymentAmount', 'partialPaymentDate', 'partialPaymentIntentId'].includes(k)
                          ).length > 0 && (
                            <div className="col-span-full">
                              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Metadata</p>
                              <div className="bg-white rounded-lg border border-gray-200 p-3">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                  {Object.entries(invoice.metadata || {})
                                    .filter(([k]) => !['isPaused', 'originalDueDate', 'adjustmentNote', 'originalAmount', 'adjustedAt', 'partialPaymentAmount', 'partialPaymentDate', 'partialPaymentIntentId'].includes(k))
                                    .map(([key, value]) => (
                                      <div key={key}>
                                        <p className="text-xs text-gray-400">{key}</p>
                                        <p className="text-sm text-gray-700">{value}</p>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
