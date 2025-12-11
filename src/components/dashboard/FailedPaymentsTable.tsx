'use client';

import { useState } from 'react';
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
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';

interface FailedPaymentsTableProps {
  invoices: InvoiceData[];
  paymentMethods?: PaymentMethodData[];
  onPayInvoice: (invoice: InvoiceData) => void;
  onVoidInvoice: (invoice: InvoiceData) => void;
  onPauseInvoice: (invoice: InvoiceData, pause: boolean) => void;
  onRetryInvoice: (invoice: InvoiceData) => void;
}

export function FailedPaymentsTable({
  invoices,
  onPayInvoice,
  onVoidInvoice,
  onPauseInvoice,
  onRetryInvoice,
}: FailedPaymentsTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
            {failedInvoices.map((invoice) => (
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
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
