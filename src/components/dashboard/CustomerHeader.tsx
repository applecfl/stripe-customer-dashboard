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

    // Total from token, or calculate from all data
    const totalFromToken = extendedInfo?.totalAmount ? extendedInfo.totalAmount * 100 : 0;
    const total = totalFromToken > 0 ? totalFromToken : (paid + scheduled + failed);

    // Outstanding = total - paid - scheduled - failed
    const outstanding = Math.max(0, total - paid - scheduled - failed);

    return { paid, scheduled, failed, outstanding, total };
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
      {/* Top Section - Customer Name, UID, Parent Info, and Actions */}
      <div className="px-3 sm:px-6 py-3 sm:py-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          {/* Left Side - Customer Info */}
          <div className="flex-1 min-w-0">
            {/* Customer Name Row */}
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

            {/* Parent/Guardian Info - Below Name */}
            {hasParentInfo && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {/* Father Info */}
                {extendedInfo?.fatherName && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="min-w-0 flex-1">
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
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-pink-100 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-pink-600" />
                    </div>
                    <div className="min-w-0 flex-1">
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
              </div>
            )}
          </div>

          {/* Right Side - Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-3 lg:flex-shrink-0 lg:ml-4">
            <Button variant="primary" size="sm" onClick={onPayNow} className="flex-1 lg:flex-none justify-center text-xs sm:text-sm px-3 sm:px-4">
              <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Charge</span>
            </Button>
            <Button variant="outline" size="sm" onClick={onAddPaymentMethod} className="flex-1 lg:flex-none justify-center text-xs sm:text-sm px-3 sm:px-4">
              <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Add Card</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Payment Summary Section - Bottom */}
      <div className="px-3 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-t border-indigo-100">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
          {/* Paid */}
          <div className="bg-white rounded-lg p-2 sm:p-3 border border-green-200 shadow-sm flex flex-col items-center justify-center text-center h-full">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              <span className="text-[10px] sm:text-xs text-gray-500 font-medium">Paid</span>
            </div>
            <p className="text-base sm:text-lg font-semibold text-green-600">
              {formatCurrency(summary.paid, currency)}
            </p>
          </div>

          {/* Scheduled */}
          <div className="bg-white rounded-lg p-2 sm:p-3 border border-indigo-200 shadow-sm flex flex-col items-center justify-center text-center h-full">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="w-3.5 h-3.5 text-indigo-500" />
              <span className="text-[10px] sm:text-xs text-gray-500 font-medium">Scheduled</span>
            </div>
            <p className="text-base sm:text-lg font-semibold text-indigo-600">
              {formatCurrency(summary.scheduled, currency)}
            </p>
          </div>

          {/* Failed */}
          <div className="bg-white rounded-lg p-2 sm:p-3 border border-red-200 shadow-sm flex flex-col items-center justify-center text-center h-full">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
              <span className="text-[10px] sm:text-xs text-gray-500 font-medium">Failed</span>
            </div>
            <p className="text-base sm:text-lg font-semibold text-red-600">
              {formatCurrency(summary.failed, currency)}
            </p>
          </div>

          {/* Outstanding */}
          <div className="bg-white rounded-lg p-2 sm:p-3 border border-amber-200 shadow-sm flex flex-col items-center justify-center text-center h-full">
            <div className="flex items-center gap-1.5 mb-1">
              <XCircle className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-[10px] sm:text-xs text-gray-500 font-medium">Outstanding</span>
            </div>
            <p className="text-base sm:text-lg font-semibold text-amber-600">
              {formatCurrency(summary.outstanding, currency)}
            </p>
          </div>

          {/* Total Amount */}
          <div className="col-span-2 sm:col-span-1 bg-white rounded-lg p-2 sm:p-3 border border-purple-200 shadow-sm flex flex-col items-center justify-center text-center h-full">
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
              <span className="text-[10px] sm:text-xs text-gray-500 font-medium">Total</span>
            </div>
            <p className="text-base sm:text-lg font-bold text-gray-900">
              {formatCurrency(summary.total, currency)}
            </p>
            {paymentName && paymentName !== 'Total' && (
              <p className="text-[10px] sm:text-xs text-purple-600 font-medium mt-0.5 break-words">{paymentName}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
