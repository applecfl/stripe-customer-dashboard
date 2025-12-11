'use client';

import { useState, useMemo } from 'react';
import { PaymentMethodData, InvoiceData } from '@/types';
import { formatDate } from '@/lib/utils';
import {
  Card,
  CardHeader,
  CardContent,
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmptyState,
} from '@/components/ui';
import { CreditCard, Star, Trash2, Plus } from 'lucide-react';

interface PaymentMethodsTableProps {
  paymentMethods: PaymentMethodData[];
  invoices?: InvoiceData[];
  onSetDefault: (pm: PaymentMethodData) => void;
  onDelete: (pm: PaymentMethodData) => void;
  onBatchDelete?: (pmIds: string[]) => Promise<void>;
  onAddCard?: () => void;
  loading?: boolean;
}

const cardBrandLogos: Record<string, string> = {
  visa: '💳',
  mastercard: '💳',
  amex: '💳',
  discover: '💳',
  diners: '💳',
  jcb: '💳',
  unionpay: '💳',
};

export function PaymentMethodsTable({
  paymentMethods,
  invoices = [],
  onSetDefault,
  onDelete,
  onBatchDelete,
  onAddCard,
  loading,
}: PaymentMethodsTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  // Get set of payment method IDs that are connected to open/draft invoices
  const linkedPaymentMethodIds = useMemo(() => {
    const ids = new Set<string>();
    invoices.forEach(inv => {
      if ((inv.status === 'open' || inv.status === 'draft') && inv.default_payment_method) {
        ids.add(inv.default_payment_method);
      }
    });
    return ids;
  }, [invoices]);

  // Count invoices per payment method
  const invoiceCountByPm = useMemo(() => {
    const counts = new Map<string, number>();
    invoices.forEach(inv => {
      if ((inv.status === 'open' || inv.status === 'draft') && inv.default_payment_method) {
        counts.set(inv.default_payment_method, (counts.get(inv.default_payment_method) || 0) + 1);
      }
    });
    return counts;
  }, [invoices]);

  // Check if a payment method can be deleted (not default, not linked to invoices)
  const canDelete = (pm: PaymentMethodData) => {
    return !pm.isDefault && !linkedPaymentMethodIds.has(pm.id);
  };

  // Filter out default and linked payment methods from selectable items
  const selectablePaymentMethods = paymentMethods.filter(pm => canDelete(pm));
  const allSelected = selectablePaymentMethods.length > 0 &&
    selectablePaymentMethods.every(pm => selectedIds.includes(pm.id));

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectablePaymentMethods.map(pm => pm.id));
    }
  };

  const handleToggleSelect = (pmId: string) => {
    setSelectedIds(prev =>
      prev.includes(pmId)
        ? prev.filter(id => id !== pmId)
        : [...prev, pmId]
    );
  };

  const handleBatchDelete = async () => {
    if (!onBatchDelete || selectedIds.length === 0) return;

    setDeleting(true);
    try {
      await onBatchDelete(selectedIds);
      setSelectedIds([]);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader
        action={
          <div className="flex items-center gap-3">
            {selectedIds.length > 0 && onBatchDelete && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleBatchDelete}
                loading={deleting}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-4 h-4" />
                Delete ({selectedIds.length})
              </Button>
            )}
            {onAddCard && (
              <Button
                variant="outline"
                size="sm"
                onClick={onAddCard}
              >
                <Plus className="w-4 h-4" />
                Add Card
              </Button>
            )}
            <span className="text-sm text-gray-500">
              {paymentMethods.length} card{paymentMethods.length !== 1 ? 's' : ''}
            </span>
          </div>
        }
      >
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-indigo-600" />
          Payment Methods
        </div>
      </CardHeader>
      <CardContent noPadding>
        <Table>
          <TableHeader>
            <TableRow hoverable={false}>
              {onBatchDelete && selectablePaymentMethods.length > 0 && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    title="Select all"
                  />
                </TableHead>
              )}
              <TableHead>Card</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead>Added</TableHead>
              <TableHead align="right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paymentMethods.length === 0 ? (
              <TableEmptyState
                message="No payment methods"
                icon={<CreditCard className="w-12 h-12" />}
              />
            ) : (
              paymentMethods.map((pm) => {
                const isLinkedToInvoices = linkedPaymentMethodIds.has(pm.id);
                const invoiceCount = invoiceCountByPm.get(pm.id) || 0;
                const deletable = canDelete(pm);

                return (
                  <TableRow key={pm.id}>
                    {onBatchDelete && selectablePaymentMethods.length > 0 && (
                      <TableCell>
                        {deletable ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(pm.id)}
                            onChange={() => handleToggleSelect(pm.id)}
                            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        ) : (
                          <span className="w-4 h-4 inline-block" />
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-12 h-8 rounded-lg flex items-center justify-center ${
                            pm.isDefault ? 'bg-indigo-100' : 'bg-gray-100'
                          }`}
                        >
                          <span className="text-lg">
                            {cardBrandLogos[pm.card?.brand || ''] || '💳'}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            <span className="capitalize">{pm.card?.brand}</span>
                            {' •••• '}
                            {pm.card?.last4}
                          </p>
                          <p className="text-xs text-gray-500 font-mono">
                            {pm.id.slice(0, 20)}...
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-700">
                        {pm.card?.exp_month.toString().padStart(2, '0')}/
                        {pm.card?.exp_year}
                      </span>
                    </TableCell>
                    <TableCell>{formatDate(pm.created)}</TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-1">
                        {!pm.isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onSetDefault(pm)}
                            title="Set as Default"
                          >
                            <Star className="w-4 h-4" />
                          </Button>
                        )}
                        {deletable ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDelete(pm)}
                            title="Remove Card"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled
                            title={pm.isDefault ? "Can't delete default card" : "Card is linked to invoices"}
                          >
                            <Trash2 className="w-4 h-4 text-gray-300" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
