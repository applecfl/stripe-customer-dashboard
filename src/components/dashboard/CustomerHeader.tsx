'use client';

import { CustomerData } from '@/types';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui';
import {
  Mail,
  Phone,
  Calendar,
  CreditCard,
  DollarSign,
} from 'lucide-react';

interface CustomerHeaderProps {
  customer: CustomerData;
  onAddPaymentMethod: () => void;
  onPayNow: () => void;
}

export function CustomerHeader({
  customer,
  onAddPaymentMethod,
  onPayNow,
}: CustomerHeaderProps) {
  return (
    <div className="bg-white rounded-xl sm:rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Main Customer Info */}
      <div className="px-4 sm:px-8 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          {/* Customer Details */}
          <div className="flex items-start gap-3 sm:gap-5">
            {/* Avatar */}
            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xl sm:text-2xl font-bold shadow-lg flex-shrink-0">
              {customer.name?.charAt(0).toUpperCase() || 'C'}
            </div>

            {/* Info */}
            <div className="space-y-1 min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">
                {customer.name || 'Unnamed Customer'}
              </h1>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 text-xs sm:text-sm text-gray-500">
                {customer.email && (
                  <span className="flex items-center gap-1.5 truncate">
                    <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
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
              <p className="text-[10px] sm:text-xs text-gray-400 font-mono truncate">{customer.id}</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-3 sm:flex-shrink-0">
            <Button variant="primary" size="sm" onClick={onPayNow} className="flex-1 sm:flex-none justify-center">
              <DollarSign className="w-4 h-4" />
              <span>Pay Now</span>
            </Button>
            <Button variant="outline" size="sm" onClick={onAddPaymentMethod} className="flex-1 sm:flex-none justify-center">
              <CreditCard className="w-4 h-4" />
              <span className="hidden sm:inline">Add Card</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
