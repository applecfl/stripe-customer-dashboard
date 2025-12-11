'use client';

import { useState } from 'react';
import { InvoiceData, PaymentData, PaymentMethodData } from '@/types';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
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
  FileText,
  CreditCard,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
  DollarSign,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  Hash,
  Calendar,
  Wallet,
  MessageSquare,
  RotateCcw,
} from 'lucide-react';

interface TransactionsTableProps {
  invoices: InvoiceData[];
  payments: PaymentData[];
  paymentMethods?: PaymentMethodData[];
  onPayInvoice: (invoice: InvoiceData) => void;
  onVoidInvoice: (invoice: InvoiceData) => void;
  onPauseInvoice: (invoice: InvoiceData, pause: boolean) => void;
  onRetryInvoice: (invoice: InvoiceData) => void;
  onRefund: (payment: PaymentData) => void;
}

export function TransactionsTable({
  invoices,
  payments,
  paymentMethods = [],
  onPayInvoice,
  onVoidInvoice,
  onPauseInvoice,
  onRetryInvoice,
  onRefund,
}: TransactionsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Create a map for quick payment method lookup
  const paymentMethodMap = new Map(paymentMethods.map(pm => [pm.id, pm]));

  // Only show failed invoices (open with payment attempts)
  const failedInvoices = invoices
    .filter(inv => inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0)
    .sort((a, b) => (b.due_date || b.created) - (a.due_date || a.created));

  const succeededPayments = payments
    .filter(p => p.status === 'succeeded')
    .sort((a, b) => b.created - a.created);

  const toggleExpanded = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // Helper to get payment invoice info from metadata
  const getPaymentInvoiceInfo = (payment: PaymentData) => {
    const invoiceIds = payment.metadata?.invoicesPaid?.split(',').filter(Boolean) || [];
    const invoiceNumbers = payment.metadata?.invoiceNumbersPaid?.split(',').filter(Boolean) || [];
    const totalApplied = parseInt(payment.metadata?.totalAppliedToInvoices || '0', 10);
    const creditAdded = parseInt(payment.metadata?.creditAdded || '0', 10);
    const reason = payment.metadata?.reason || payment.metadata?.lastPaymentReason;
    const invoiceUID = payment.metadata?.InvoiceUID;
    return { invoiceIds, invoiceNumbers, totalApplied, creditAdded, reason, invoiceUID };
  };

  const hasFailedInvoices = failedInvoices.length > 0;
  const hasPayments = succeededPayments.length > 0;

  if (!hasFailedInvoices && !hasPayments) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-gray-400" />
            Transactions
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No transactions found
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Failed Invoices Section */}
      {hasFailedInvoices && (
        <Card>
          <CardHeader
            action={
              <span className="text-sm text-gray-500">
                {failedInvoices.length} invoice{failedInvoices.length !== 1 ? 's' : ''}
              </span>
            }
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Failed Invoices
            </div>
          </CardHeader>
          <CardContent noPadding>
            <Table>
              <TableHeader>
                <TableRow hoverable={false}>
                  <TableHead className="w-8 sm:w-10"></TableHead>
                  <TableHead align="right" className="w-24 sm:w-32">Amount</TableHead>
                  <TableHead className="w-8 sm:w-12"></TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedInvoices.map((invoice) => {
                  const isExpanded = expandedId === `inv-${invoice.id}`;

                  return (
                    <>
                      <TableRow key={invoice.id} className="bg-red-50/50">
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
                        <TableCell align="right">
                          <div>
                            <span className="font-semibold text-red-700 text-xs sm:text-sm">
                              {formatCurrency(invoice.amount_due, invoice.currency)}
                            </span>
                            {invoice.amount_remaining > 0 && invoice.amount_remaining !== invoice.amount_due && (
                              <p className="text-[10px] sm:text-xs text-amber-600">
                                {formatCurrency(invoice.amount_remaining, invoice.currency)} <span className="hidden sm:inline">remaining</span>
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {/* Red exclamation mark with tooltip */}
                          <div className="relative group">
                            <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-red-100 flex items-center justify-center cursor-help">
                              <AlertCircle className="w-3 h-3 sm:w-4 sm:h-4 text-red-600" />
                            </div>
                            {/* Tooltip - positioned above with high z-index */}
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-[100]">
                              <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg min-w-[200px]">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between border-b border-gray-700 pb-2">
                                    <span className="font-medium text-red-400">Payment Failed</span>
                                    <span className="bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded text-[10px]">
                                      {invoice.attempt_count} attempt{invoice.attempt_count !== 1 ? 's' : ''}
                                    </span>
                                  </div>

                                  {/* Last failure reason */}
                                  {invoice.last_payment_error && (
                                    <div className="space-y-1">
                                      <p className="text-gray-400 text-[10px] uppercase">Last failure:</p>
                                      <div className="bg-red-500/10 rounded p-2">
                                        {invoice.last_payment_error.message && (
                                          <p className="text-red-300 whitespace-normal">
                                            {invoice.last_payment_error.message}
                                          </p>
                                        )}
                                        {invoice.last_payment_error.decline_code && (
                                          <p className="text-red-400/70 text-[10px] mt-1">
                                            Code: <span className="font-mono">{invoice.last_payment_error.decline_code}</span>
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Next retry */}
                                  {invoice.next_payment_attempt && (
                                    <div className="flex items-center gap-1.5 text-gray-300 pt-1 border-t border-gray-700">
                                      <Clock className="w-3 h-3" />
                                      <span>Next retry: {formatDate(invoice.next_payment_attempt)}</span>
                                    </div>
                                  )}
                                </div>
                                {/* Tooltip arrow pointing down */}
                                <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell align="right">
                          {/* Desktop: inline buttons */}
                          <div className="hidden sm:flex items-center justify-end gap-2">
                            <button
                              onClick={() => onRetryInvoice(invoice)}
                              className="text-sm text-gray-600 hover:text-indigo-600 transition-colors"
                            >
                              Retry
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => onPayInvoice(invoice)}
                              className="text-sm text-gray-600 hover:text-indigo-600 transition-colors"
                            >
                              Pay
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => onPauseInvoice(invoice, !invoice.isPaused)}
                              className="text-sm text-gray-600 hover:text-indigo-600 transition-colors"
                            >
                              {invoice.isPaused ? 'Resume' : 'Pause'}
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => onVoidInvoice(invoice)}
                              className="text-sm text-red-500 hover:text-red-700 transition-colors"
                            >
                              Void
                            </button>
                          </div>
                          {/* Mobile: same inline buttons, user can scroll */}
                          <div className="sm:hidden flex items-center justify-end gap-2">
                            <button
                              onClick={() => onRetryInvoice(invoice)}
                              className="text-xs text-gray-600 hover:text-indigo-600 transition-colors whitespace-nowrap"
                            >
                              Retry
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => onPayInvoice(invoice)}
                              className="text-xs text-gray-600 hover:text-indigo-600 transition-colors whitespace-nowrap"
                            >
                              Pay
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => onPauseInvoice(invoice, !invoice.isPaused)}
                              className="text-xs text-gray-600 hover:text-indigo-600 transition-colors whitespace-nowrap"
                            >
                              {invoice.isPaused ? 'Resume' : 'Pause'}
                            </button>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => onVoidInvoice(invoice)}
                              className="text-xs text-red-500 hover:text-red-700 transition-colors whitespace-nowrap"
                            >
                              Void
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <tr key={`${invoice.id}-details`}>
                          <td colSpan={4} className="bg-gray-50 px-6 py-4 border-b">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div>
                                <p className="text-xs font-medium text-gray-500 uppercase">ID</p>
                                <p className="text-sm text-gray-900 font-mono">{invoice.id}</p>
                              </div>

                              {invoice.last_payment_error && (
                                <div className="col-span-2">
                                  <p className="text-xs font-medium text-red-600 uppercase">Payment Failed</p>
                                  <div className="bg-red-50 rounded-lg p-3 mt-1 border border-red-200">
                                    <div className="flex items-start gap-2">
                                      <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                      <div className="space-y-1">
                                        {invoice.last_payment_error.message && (
                                          <p className="text-sm text-red-700">{invoice.last_payment_error.message}</p>
                                        )}
                                        {invoice.last_payment_error.decline_code && (
                                          <p className="text-xs text-red-600">
                                            Decline code: <span className="font-mono">{invoice.last_payment_error.decline_code}</span>
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {invoice.description && (
                                <div>
                                  <p className="text-xs font-medium text-gray-500 uppercase">Description</p>
                                  <p className="text-sm text-gray-900">{invoice.description}</p>
                                </div>
                              )}

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
        </Card>
      )}

      {/* Payments Section */}
      {hasPayments && (
        <Card>
          <CardHeader
            action={
              <span className="text-sm text-gray-500">
                {succeededPayments.length} payment{succeededPayments.length !== 1 ? 's' : ''}
              </span>
            }
          >
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              Payments
            </div>
          </CardHeader>
          <CardContent noPadding>
            <Table>
              <TableHeader>
                <TableRow hoverable={false}>
                  <TableHead className="w-8 sm:w-10"></TableHead>
                  <TableHead align="right" className="w-24 sm:w-32">Amount</TableHead>
                  <TableHead className="w-24 sm:w-40">Date</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {succeededPayments.map((payment) => {
                  const isExpanded = expandedId === `pay-${payment.id}`;
                  const invoiceInfo = getPaymentInvoiceInfo(payment);

                  return (
                    <>
                      <TableRow key={payment.id} className={payment.amount_refunded > 0 ? 'bg-gray-50/50' : ''}>
                        <TableCell>
                          <div className="flex items-center gap-0.5 sm:gap-1">
                            <button
                              onClick={() => toggleExpanded(`pay-${payment.id}`)}
                              className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-500" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-500" />
                              )}
                            </button>
                            <a
                              href={`https://dashboard.stripe.com/payments/${payment.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors hidden sm:block"
                              title="Open in Stripe"
                            >
                              <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 hover:text-indigo-600" />
                            </a>
                          </div>
                        </TableCell>
                        <TableCell align="right">
                          <div className="text-right">
                            {payment.amount_refunded > 0 ? (
                              <div className="inline-flex flex-col items-end gap-0.5 font-mono text-xs sm:text-sm">
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
                        <TableCell>
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
                        <TableCell align="right">
                          {payment.status === 'succeeded' && payment.amount_refunded < payment.amount ? (
                            <button
                              onClick={() => onRefund(payment)}
                              className="text-xs sm:text-sm text-gray-600 hover:text-indigo-600 transition-colors"
                            >
                              Refund
                            </button>
                          ) : payment.amount_refunded >= payment.amount ? (
                            <span className="text-[10px] sm:text-xs text-red-400 font-medium"><span className="hidden sm:inline">Fully </span>Refunded</span>
                          ) : null}
                        </TableCell>
                      </TableRow>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <tr key={`${payment.id}-details`}>
                          <td colSpan={4} className="bg-gray-50 px-4 py-3 border-b">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                              {/* Payment Intent ID */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                  <Hash className="w-3 h-3" />
                                  Payment Intent
                                </div>
                                <a
                                  href={`https://dashboard.stripe.com/payments/${payment.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-xs text-blue-600 hover:underline flex items-center gap-1"
                                >
                                  {payment.id}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>

                              {/* Payment Date */}
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                  <Calendar className="w-3 h-3" />
                                  Payment Date
                                </div>
                                <p className="text-gray-700">{formatDateTime(payment.created)}</p>
                              </div>

                              {/* InvoiceUID */}
                              {invoiceInfo.invoiceUID && (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                    <Hash className="w-3 h-3" />
                                    Invoice UID
                                  </div>
                                  <p className="font-mono text-xs text-gray-700">{invoiceInfo.invoiceUID}</p>
                                </div>
                              )}

                              {/* Linked Invoice from Stripe */}
                              {payment.invoice && (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                    <FileText className="w-3 h-3" />
                                    Stripe Invoice
                                  </div>
                                  <a
                                    href={`https://dashboard.stripe.com/invoices/${payment.invoice}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-blue-600 hover:underline flex items-center gap-1"
                                  >
                                    {payment.invoiceNumber || payment.invoice}
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              )}

                              {/* Invoices paid via PayNow */}
                              {invoiceInfo.invoiceIds.length > 0 && (
                                <div className="space-y-1 col-span-full md:col-span-2">
                                  <div className="flex items-center gap-1.5 text-gray-500 text-xs font-medium uppercase">
                                    <FileText className="w-3 h-3" />
                                    Invoices Paid ({invoiceInfo.invoiceIds.length})
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {invoiceInfo.invoiceIds.map((id, idx) => {
                                      // Check if invoice still exists (partially paid) or was deleted/voided (fully paid)
                                      const invoiceStillExists = invoices.some(inv => inv.id === id);
                                      const displayName = invoiceInfo.invoiceNumbers[idx] || id.slice(0, 12);

                                      if (invoiceStillExists) {
                                        // Partial payment - invoice still exists, show link
                                        return (
                                          <a
                                            key={id}
                                            href={`https://dashboard.stripe.com/invoices/${id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-medium hover:bg-amber-200 transition-colors"
                                          >
                                            {displayName}
                                            <ExternalLink className="w-3 h-3" />
                                          </a>
                                        );
                                      } else {
                                        // Fully paid - invoice deleted/voided, show without link
                                        return (
                                          <span
                                            key={id}
                                            className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium"
                                          >
                                            {displayName}
                                            <Check className="w-3 h-3" />
                                          </span>
                                        );
                                      }
                                    })}
                                  </div>
                                  {invoiceInfo.totalApplied > 0 && (
                                    <p className="text-xs text-gray-500">
                                      Total applied to invoices: {formatCurrency(invoiceInfo.totalApplied, payment.currency)}
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
                    </>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
