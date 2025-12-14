'use client';

import { useState } from 'react';
import { InvoiceData, PaymentData, PaymentMethodData } from '@/types';
import { formatCurrency, formatDateTime, formatDate } from '@/lib/utils';
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
} from 'lucide-react';

interface SuccessfulPaymentsTableProps {
  invoices: InvoiceData[];
  payments: PaymentData[];
  paymentMethods?: PaymentMethodData[];
  onRefund: (payment: PaymentData) => void;
}

export function SuccessfulPaymentsTable({
  invoices,
  payments,
  onRefund,
}: SuccessfulPaymentsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    const invoiceAmounts = payment.metadata?.invoiceAmounts?.split(',').filter(Boolean).map(a => parseInt(a, 10)) || [];
    const totalApplied = parseInt(payment.metadata?.totalAppliedToInvoices || '0', 10);
    const creditAdded = parseInt(payment.metadata?.creditAdded || '0', 10);
    const reason = payment.metadata?.reason || payment.metadata?.lastPaymentReason;
    const invoiceUID = payment.metadata?.InvoiceUID;
    return { invoiceIds, invoiceNumbers, invoiceAmounts, totalApplied, creditAdded, reason, invoiceUID };
  };

  if (succeededPayments.length === 0) {
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
            {succeededPayments.length} payment{succeededPayments.length !== 1 ? 's' : ''}
          </span>
        }
      >
        <div className="flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          Successful Payments
        </div>
      </CardHeader>
      <CardContent noPadding>
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow hoverable={false}>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead className="w-[120px]">Amount</TableHead>
              <TableHead className="w-[120px]">Date</TableHead>
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
                    <TableCell>
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors"
                          title="Refund Payment"
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Refund</span>
                        </button>
                      ) : payment.amount_refunded >= payment.amount ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] sm:text-xs text-red-500 bg-red-50 rounded-md font-medium">
                          <Check className="w-3 h-3" />
                          <span className="hidden sm:inline">Fully </span>Refunded
                        </span>
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
                                  Total applied to payments: {formatCurrency(invoiceInfo.totalApplied, payment.currency)}
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
  );
}
