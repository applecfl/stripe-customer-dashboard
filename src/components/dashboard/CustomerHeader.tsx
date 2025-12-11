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
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Main Customer Info */}
      <div className="px-8 py-6">
        <div className="flex items-start justify-between">
          {/* Customer Details */}
          <div className="flex items-start gap-5">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
              {customer.name?.charAt(0).toUpperCase() || 'C'}
            </div>

            {/* Info */}
            <div className="space-y-1">
              <h1 className="text-2xl font-bold text-gray-900">
                {customer.name || 'Unnamed Customer'}
              </h1>
              <div className="flex items-center gap-4 text-sm text-gray-500">
                {customer.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="w-4 h-4" />
                    {customer.email}
                  </span>
                )}
                {customer.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="w-4 h-4" />
                    {customer.phone}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  Customer since {formatDate(customer.created)}
                </span>
              </div>
              <p className="text-xs text-gray-400 font-mono">{customer.id}</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" onClick={onPayNow}>
              <DollarSign className="w-4 h-4" />
              Pay Now
            </Button>
            <Button variant="outline" size="sm" onClick={onAddPaymentMethod}>
              <CreditCard className="w-4 h-4" />
              Add Card
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
