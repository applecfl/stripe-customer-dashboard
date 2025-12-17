'use client';

import { useState } from 'react';
import { CustomerData, ExtendedCustomerInfo, InvoiceData, PaymentData, OtherPayment } from '@/types';
import { formatDate, formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui';
import {
  Mail,
  Phone,
  CreditCard,
  DollarSign,
  User,
  Copy,
  Check,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
} from 'lucide-react';

interface CustomerHeaderProps {
  customer: CustomerData;
  extendedInfo?: ExtendedCustomerInfo;
  invoiceUID: string;
  invoices: InvoiceData[];
  payments: PaymentData[];
  otherPayments?: OtherPayment[];
  onAddPaymentMethod: () => void;
  onPayNow: () => void;
  onTabChange?: (tab: 'failed' | 'success' | 'future') => void;
}

export function CustomerHeader({
  customer,
  extendedInfo,
  invoiceUID,
  invoices,
  payments,
  otherPayments,
  onAddPaymentMethod,
  onPayNow,
  onTabChange,
}: CustomerHeaderProps) {
  const [copied, setCopied] = useState(false);

  // Check if we have parent info to display
  const hasParentInfo = extendedInfo && (
    extendedInfo.fatherName || extendedInfo.motherName
  );

  const currency = customer.currency || 'usd';

  // Calculate payment summary
  const calculateSummary = () => {
    // Paid = successful payments + other payments (Zelle, Cash, etc.)
    const paidFromStripe = payments
      .filter(p => p.status === 'succeeded')
      .reduce((sum, p) => sum + (p.amount - p.amount_refunded), 0);
    const paidFromOther = otherPayments?.reduce((sum, p) => sum + (p.amount * 100), 0) || 0;
    const paid = paidFromStripe + paidFromOther;

    // Scheduled = draft invoices
    const scheduled = invoices
      .filter(inv => inv.status === 'draft')
      .reduce((sum, inv) => sum + inv.amount_due, 0);

    // Failed = open invoices with attempt_count > 0
    const failed = invoices
      .filter(inv => inv.status === 'open' && inv.attempt_count > 0)
      .reduce((sum, inv) => sum + inv.amount_remaining, 0);

    // Total from token if provided, otherwise calculate from all data
    // Use token total if explicitly set (even if 0), otherwise use calculated total
    const totalFromToken = extendedInfo?.totalAmount !== undefined ? extendedInfo.totalAmount * 100 : null;
    const calculatedTotal = paid + scheduled + failed;
    const total = totalFromToken !== null ? totalFromToken : calculatedTotal;

    // Outstanding = total - paid - scheduled - failed (can be negative for overpay)
    const outstandingRaw = total - paid - scheduled - failed;
    const outstanding = Math.max(0, outstandingRaw);
    const overpay = outstandingRaw < 0 ? Math.abs(outstandingRaw) : 0;

    return { paid, scheduled, failed, outstanding, overpay, total };
  };

  const summary = calculateSummary();
  const paymentName = extendedInfo?.paymentName || 'Total';

  const handleCopyUID = async () => {
    try {
      await navigator.clipboard.writeText(invoiceUID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Top Section - Customer Name, UID, and Actions */}
      <div className="px-3 sm:px-6 py-3 sm:py-5">
        {/* First Row - Customer Name/Avatar/UID + Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          {/* Left Side - Customer Info */}
          <div className="flex items-start gap-3 sm:gap-4">
            {/* Avatar */}
            <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-lg sm:rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-lg sm:text-2xl font-bold shadow-lg flex-shrink-0">
              {customer.name?.charAt(0).toUpperCase() || 'C'}
            </div>

            {/* Name & UID */}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                {customer.name || 'Unnamed Customer'}
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-gray-500">Customer since {formatDate(customer.created)}</span>
              </div>
              {/* Payment UID with copy */}
              <button
                onClick={handleCopyUID}
                className="flex items-center gap-1.5 mt-1.5 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors group"
                title="Click to copy"
              >
                <span className="text-[10px] sm:text-xs text-gray-500 font-mono truncate max-w-[200px]">
                  {invoiceUID}
                </span>
                {copied ? (
                  <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                ) : (
                  <Copy className="w-3 h-3 text-gray-400 group-hover:text-gray-600 flex-shrink-0" />
                )}
              </button>
            </div>
          </div>

          {/* Right Side - Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <Button variant="primary" size="sm" onClick={onPayNow} className="flex-1 sm:flex-none justify-center text-xs sm:text-sm px-3 sm:px-4">
              <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Charge</span>
            </Button>
            <Button variant="outline" size="sm" onClick={onAddPaymentMethod} className="flex-1 sm:flex-none justify-center text-xs sm:text-sm px-3 sm:px-4">
              <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Add Card</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        </div>

        {/* Second Row - Parent/Guardian Info + Total Amount - Full Width */}
        {hasParentInfo && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            {/* Parents row - always horizontal */}
            <div className="flex flex-row gap-4 sm:gap-8 flex-wrap">
              {/* Father Info */}
              {extendedInfo?.fatherName && (
                <div className="flex items-start gap-2 sm:gap-3 flex-shrink-0">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-medium">Father</p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{extendedInfo.fatherName}</p>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mt-0.5">
                      {extendedInfo.fatherEmail && (
                        <a href={`mailto:${extendedInfo.fatherEmail}`} className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 truncate">
                          <Mail className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{extendedInfo.fatherEmail}</span>
                        </a>
                      )}
                      {extendedInfo.fatherCell && (
                        <a href={`tel:${extendedInfo.fatherCell}`} className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600">
                          <Phone className="w-3 h-3 flex-shrink-0" />
                          {extendedInfo.fatherCell}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Mother Info */}
              {extendedInfo?.motherName && (
                <div className="flex items-start gap-2 sm:gap-3 flex-shrink-0">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                    <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-pink-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500 font-medium">Mother</p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{extendedInfo.motherName}</p>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mt-0.5">
                      {extendedInfo.motherEmail && (
                        <a href={`mailto:${extendedInfo.motherEmail}`} className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600 truncate">
                          <Mail className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{extendedInfo.motherEmail}</span>
                        </a>
                      )}
                      {extendedInfo.motherCell && (
                        <a href={`tel:${extendedInfo.motherCell}`} className="flex items-center gap-1 text-xs text-gray-500 hover:text-indigo-600">
                          <Phone className="w-3 h-3 flex-shrink-0" />
                          {extendedInfo.motherCell}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Total Amount - Desktop only, inline with parents */}
              <div className="hidden sm:flex items-start gap-3 flex-1">
                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-5 h-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  {paymentName && paymentName !== 'Total' && (
                    <p className="text-sm text-purple-700 font-semibold mb-0.5">
                      {paymentName}
                    </p>
                  )}
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">
                    <span className="text-sm sm:text-base text-gray-500 font-medium">Total: </span>
                    {formatCurrency(summary.total, currency)}
                  </p>
                </div>
              </div>
            </div>

            {/* Mobile: Description and Total centered below parents */}
            <div className="sm:hidden mt-4 text-center">
              {paymentName && paymentName !== 'Total' && (
                <p className="text-base text-purple-700 font-semibold mb-1">
                  {paymentName}
                </p>
              )}
              <p className="text-xl font-bold text-gray-900">
                <span className="text-sm text-gray-500 font-medium">Total: </span>
                {formatCurrency(summary.total, currency)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Payment Summary Section - Bottom */}
      <div className="px-3 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-t border-indigo-100">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {/* Successful Payments */}
          <button
            type="button"
            onClick={() => onTabChange?.('success')}
            className="bg-white rounded-lg p-3 sm:p-4 border border-green-200 shadow-sm flex flex-col items-center justify-center text-center h-full cursor-pointer hover:bg-green-50 hover:border-green-300 transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-xs sm:text-sm text-gray-600 font-medium">Successful Payments</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-green-600">
              {formatCurrency(summary.paid, currency)}
            </p>
          </button>

          {/* Scheduled Payments */}
          <button
            type="button"
            onClick={() => onTabChange?.('future')}
            className="bg-white rounded-lg p-3 sm:p-4 border border-indigo-200 shadow-sm flex flex-col items-center justify-center text-center h-full cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <Clock className="w-4 h-4 text-indigo-500" />
              <span className="text-xs sm:text-sm text-gray-600 font-medium">Scheduled Payments</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-indigo-600">
              {formatCurrency(summary.scheduled, currency)}
            </p>
          </button>

          {/* Failed Payments */}
          <button
            type="button"
            onClick={() => onTabChange?.('failed')}
            className="bg-white rounded-lg p-3 sm:p-4 border border-red-200 shadow-sm flex flex-col items-center justify-center text-center h-full cursor-pointer hover:bg-red-50 hover:border-red-300 transition-colors"
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <span className="text-xs sm:text-sm text-gray-600 font-medium">Failed Payments</span>
            </div>
            <p className="text-lg sm:text-2xl font-bold text-red-600">
              {formatCurrency(summary.failed, currency)}
            </p>
          </button>

          {/* Outstanding or Overpay */}
          <div className={`bg-white rounded-lg p-3 sm:p-4 border shadow-sm flex flex-col items-center justify-center text-center h-full ${
            summary.overpay > 0 ? 'border-green-200' : 'border-amber-200'
          }`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              {summary.overpay > 0 ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-xs sm:text-sm text-gray-600 font-medium">Overpaid</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-amber-500" />
                  <span className="text-xs sm:text-sm text-gray-600 font-medium">Outstanding</span>
                </>
              )}
            </div>
            <p className={`text-lg sm:text-2xl font-bold ${
              summary.overpay > 0 ? 'text-green-600' : 'text-amber-600'
            }`}>
              {summary.overpay > 0
                ? formatCurrency(summary.overpay, currency)
                : formatCurrency(summary.outstanding, currency)
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
