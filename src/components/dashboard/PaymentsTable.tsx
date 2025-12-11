'use client';

import React, { useState } from 'react';
import { PaymentData } from '@/types';
import { formatCurrency, formatDateTime } from '@/lib/utils';
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
import { CreditCard, RotateCcw, Link2Off, ArrowDownRight, ChevronDown, ChevronUp, FileText, Wallet, ExternalLink, Calendar, Hash, MessageSquare } from 'lucide-react';

interface PaymentsTableProps {
  payments: PaymentData[];
  onRefund: (payment: PaymentData) => void;
  loading?: boolean;
  title?: string;
  showOrphanOnly?: boolean;
}

export function PaymentsTable({
  payments,
  onRefund,
  loading,
  title = 'Payments',
  showOrphanOnly = false,
}: PaymentsTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredPayments = showOrphanOnly
    ? payments.filter((p) => !p.invoice)
    : payments;

  const toggleExpand = (paymentId: string) => {
    setExpandedId(expandedId === paymentId ? null : paymentId);
  };

  const getInvoiceInfo = (payment: PaymentData) => {
    const invoiceIds = payment.metadata?.invoicesPaid?.split(',').filter(Boolean) || [];
    const invoiceNumbers = payment.metadata?.invoiceNumbersPaid?.split(',').filter(Boolean) || [];
    const totalApplied = parseInt(payment.metadata?.totalAppliedToInvoices || '0', 10);
    const creditAdded = parseInt(payment.metadata?.creditAdded || '0', 10);
    const reason = payment.metadata?.reason || payment.metadata?.lastPaymentReason;
    const invoiceUID = payment.metadata?.InvoiceUID;

    return { invoiceIds, invoiceNumbers, totalApplied, creditAdded, reason, invoiceUID };
  };

  const hasInvoiceDetails = (payment: PaymentData) => {
    // Always show expand button - at minimum we show payment intent ID and date
    return true;
  };

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-sm text-gray-500">
            {filteredPayments.length} payment{filteredPayments.length !== 1 ? 's' : ''}
          </span>
        }
      >
        <div className="flex items-center gap-2">
          {showOrphanOnly ? (
            <Link2Off className="w-5 h-5 text-amber-600" />
          ) : (
            <ArrowDownRight className="w-5 h-5 text-green-600" />
          )}
          {title}
        </div>
      </CardHeader>
      <CardContent noPadding>
        <Table>
          <TableHeader>
            <TableRow hoverable={false}>
              <TableHead className="w-8"></TableHead>
              <TableHead>Payment Intent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead align="right">Amount</TableHead>
              <TableHead align="right">Refunded</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPayments.length === 0 ? (
              <TableEmptyState
                message={showOrphanOnly ? 'No orphan payments' : 'No payments found'}
                icon={<CreditCard className="w-12 h-12" />}
              />
            ) : (
              filteredPayments.map((payment) => {
                const isExpanded = expandedId === payment.id;
                const invoiceInfo = getInvoiceInfo(payment);
                const showExpandButton = hasInvoiceDetails(payment);

                return (
                  <React.Fragment key={payment.id}>
                    <TableRow>
                      <TableCell className="w-8 pr-0">
                        {showExpandButton ? (
                          <button
                            onClick={() => toggleExpand(payment.id)}
                            className="p-1 hover:bg-gray-100 rounded transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-gray-500" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-500" />
                            )}
                          </button>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                              payment.refunded
                                ? 'bg-indigo-100'
                                : payment.status === 'succeeded'
                                ? 'bg-green-100'
                                : 'bg-gray-100'
                            }`}
                          >
                            <CreditCard
                              className={`w-4 h-4 ${
                                payment.refunded
                                  ? 'text-indigo-600'
                                  : payment.status === 'succeeded'
                                  ? 'text-green-600'
                                  : 'text-gray-600'
                              }`}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-1">
                              <p className="font-mono text-sm text-gray-900">
                                {payment.id.slice(0, 20)}...
                              </p>
                              <a
                                href={`https://dashboard.stripe.com/payments/${payment.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-0.5 hover:bg-gray-100 rounded transition-colors"
                                title="Open in Stripe"
                              >
                                <ExternalLink className="w-3 h-3 text-gray-400 hover:text-indigo-600" />
                              </a>
                            </div>
                            {payment.description && (
                              <p className="text-xs text-gray-500 truncate max-w-[180px]">
                                {payment.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge status={payment.refunded ? 'refunded' : payment.status} />
                      </TableCell>
                      <TableCell align="right">
                        <span className="font-semibold text-gray-900">
                          {formatCurrency(payment.amount, payment.currency)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        {payment.amount_refunded > 0 ? (
                          <span className="text-indigo-600">
                            {formatCurrency(payment.amount_refunded, payment.currency)}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {payment.invoiceNumber ? (
                          <span className="font-medium text-gray-700">
                            {payment.invoiceNumber}
                          </span>
                        ) : (
                          <span className="text-gray-400 flex items-center gap-1">
                            <Link2Off className="w-3 h-3" />
                            Not linked
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-gray-600">
                          {formatDateTime(payment.created)}
                        </span>
                      </TableCell>
                      <TableCell align="right">
                        {payment.status === 'succeeded' && !payment.refunded && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRefund(payment)}
                            title="Refund Payment"
                          >
                            <RotateCcw className="w-4 h-4 text-indigo-600" />
                            Refund
                          </Button>
                        )}
                        {payment.refunded && (
                          <span className="text-sm text-gray-400">Refunded</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="bg-gray-50 px-4 py-3 border-b">
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
                                  {invoiceInfo.invoiceIds.map((id, idx) => (
                                    <a
                                      key={id}
                                      href={`https://dashboard.stripe.com/invoices/${id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium hover:bg-green-200 transition-colors"
                                    >
                                      {invoiceInfo.invoiceNumbers[idx] || id.slice(0, 12)}
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  ))}
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
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
