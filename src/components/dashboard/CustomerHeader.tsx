'use client';

import { CustomerData, ExtendedCustomerInfo } from '@/types';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui';
import {
  Mail,
  Phone,
  Calendar,
  CreditCard,
  DollarSign,
  User,
} from 'lucide-react';

interface CustomerHeaderProps {
  customer: CustomerData;
  extendedInfo?: ExtendedCustomerInfo;
  onAddPaymentMethod: () => void;
  onPayNow: () => void;
}

export function CustomerHeader({
  customer,
  extendedInfo,
  onAddPaymentMethod,
  onPayNow,
}: CustomerHeaderProps) {
  // Check if we have parent info to display
  const hasParentInfo = extendedInfo && (
    extendedInfo.fatherName || extendedInfo.motherName
  );
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Main Customer Info */}
      <div className="px-3 sm:px-8 py-3 sm:py-6 ">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
          {/* Customer Details */}
          <div className="flex items-start gap-2.5 sm:gap-5">
            {/* Avatar */}
            <div className="w-10 h-10 sm:w-16 sm:h-16 rounded-lg sm:rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-lg sm:text-2xl font-bold shadow-lg flex-shrink-0">
              {customer.name?.charAt(0).toUpperCase() || 'C'}
            </div>

            {/* Info */}
            <div className="space-y-0.5 sm:space-y-1 min-w-0">
              <h1 className="text-base sm:text-2xl font-bold text-gray-900 truncate landscape-text-sm">
                {customer.name || 'Unnamed Customer'}
              </h1>
              <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-4 text-[11px] sm:text-sm text-gray-500">
                {customer.email && (
                  <span className="flex items-center gap-1 sm:gap-1.5 truncate">
                    <Mail className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                    <span className="truncate">{customer.email}</span>
                  </span>
                )}
                {customer.phone && (
                  <span className="flex items-center gap-1.5 hidden sm:flex">
                    <Phone className="w-4 h-4 flex-shrink-0" />
                    {customer.phone}
                  </span>
                )}
                <span className="flex items-center gap-1.5 hidden sm:flex">
                  <Calendar className="w-4 h-4 flex-shrink-0" />
                  Customer since {formatDate(customer.created)}
                </span>
              </div>
              <p className="text-[9px] sm:text-xs text-gray-400 font-mono truncate">{customer.id}</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 sm:gap-3 sm:flex-shrink-0">
            <Button variant="primary" size="sm" onClick={onPayNow} className="flex-1 sm:flex-none justify-center text-xs sm:text-sm px-2 sm:px-4">
              <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Charge</span>
            </Button>
            <Button variant="outline" size="sm" onClick={onAddPaymentMethod} className="flex-1 sm:flex-none justify-center text-xs sm:text-sm px-2 sm:px-4">
              <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Add Card</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Parent/Guardian Info */}
      {hasParentInfo && (
        <div className="px-3 sm:px-8 py-3 sm:py-4 bg-gray-50 border-t border-gray-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6">
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
        </div>
      )}
    </div>
  );
}
