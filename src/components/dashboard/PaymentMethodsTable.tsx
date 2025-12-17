'use client';

import { useState, useMemo } from 'react';
import { PaymentMethodData, InvoiceData } from '@/types';
import { formatDate, formatCurrency } from '@/lib/utils';
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
  Modal,
  ModalFooter,
} from '@/components/ui';
import { CreditCard, Star, Trash2, Plus, FileText, AlertTriangle } from 'lucide-react';

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
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'delete' | 'default' | 'batchDelete';
    pm: PaymentMethodData | null;
  }>({ isOpen: false, type: 'delete', pm: null });
  const [actionLoading, setActionLoading] = useState(false);

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

  // Get invoices per payment method with details
  const invoicesByPm = useMemo(() => {
    const map = new Map<string, InvoiceData[]>();
    invoices.forEach(inv => {
      if ((inv.status === 'open' || inv.status === 'draft') && inv.default_payment_method) {
        const existing = map.get(inv.default_payment_method) || [];
        existing.push(inv);
        map.set(inv.default_payment_method, existing);
      }
    });
    return map;
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

  // Confirm action handlers
  const handleConfirmAction = async () => {
    if (!confirmModal.pm && confirmModal.type !== 'batchDelete') return;

    setActionLoading(true);
    try {
      if (confirmModal.type === 'delete' && confirmModal.pm) {
        await onDelete(confirmModal.pm);
      } else if (confirmModal.type === 'default' && confirmModal.pm) {
        await onSetDefault(confirmModal.pm);
      } else if (confirmModal.type === 'batchDelete') {
        await handleBatchDelete();
      }
      setConfirmModal({ isOpen: false, type: 'delete', pm: null });
    } finally {
      setActionLoading(false);
    }
  };

  const openDeleteConfirm = (pm: PaymentMethodData) => {
    setConfirmModal({ isOpen: true, type: 'delete', pm });
  };

  const openDefaultConfirm = (pm: PaymentMethodData) => {
    setConfirmModal({ isOpen: true, type: 'default', pm });
  };

  const openBatchDeleteConfirm = () => {
    setConfirmModal({ isOpen: true, type: 'batchDelete', pm: null });
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
                onClick={openBatchDeleteConfirm}
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
              <TableHead className="hidden sm:table-cell">Added</TableHead>
              <TableHead className="hidden md:table-cell">Linked Payments</TableHead>
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
                const linkedInvoices = invoicesByPm.get(pm.id) || [];
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
                    <TableCell className="hidden sm:table-cell">{formatDate(pm.created)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {linkedInvoices.length === 0 ? (
                        <span className="text-xs text-gray-400">—</span>
                      ) : (
                        <div className="space-y-1 max-h-24 overflow-y-auto">
                          {linkedInvoices.slice(0, 3).map(inv => {
                            const isFailed = inv.status === 'open' && inv.attempt_count > 0;
                            return (
                              <div
                                key={inv.id}
                                className={`flex items-center gap-1.5 text-xs ${isFailed ? 'text-red-600' : 'text-gray-600'}`}
                              >
                                {isFailed ? (
                                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                ) : (
                                  <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                )}
                                <span className="font-medium">
                                  {formatCurrency(inv.amount_due, inv.currency)}
                                </span>
                                <span className="text-gray-400">•</span>
                                <span>
                                  {formatDate(inv.due_date || inv.created)}
                                </span>
                                {isFailed && (
                                  <span className="text-[10px] bg-red-100 text-red-600 px-1 rounded">Failed</span>
                                )}
                              </div>
                            );
                          })}
                          {linkedInvoices.length > 3 && (
                            <span className="text-[10px] text-gray-400">
                              +{linkedInvoices.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-1">
                        {!pm.isDefault && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDefaultConfirm(pm)}
                            title="Set as Default"
                          >
                            <Star className="w-4 h-4" />
                          </Button>
                        )}
                        {deletable ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteConfirm(pm)}
                            title="Remove Card"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled
                            title={pm.isDefault ? "Can't delete default card" : "Card is linked to payments"}
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

      {/* Confirmation Modal */}
      <Modal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, type: 'delete', pm: null })}
        title={
          confirmModal.type === 'delete'
            ? 'Delete Payment Method'
            : confirmModal.type === 'default'
              ? 'Set as Default'
              : 'Delete Payment Methods'
        }
        size="sm"
      >
        <div className="space-y-4">
          {confirmModal.type === 'delete' && confirmModal.pm && (
            <>
              <p className="text-gray-600">
                Are you sure you want to delete this payment method?
              </p>
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-6 rounded bg-gray-100 flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      <span className="capitalize">{confirmModal.pm.card?.brand}</span>
                      {' •••• '}
                      {confirmModal.pm.card?.last4}
                    </p>
                    <p className="text-xs text-gray-500">
                      Expires {confirmModal.pm.card?.exp_month.toString().padStart(2, '0')}/{confirmModal.pm.card?.exp_year}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {confirmModal.type === 'default' && confirmModal.pm && (
            <>
              <p className="text-gray-600">
                Set this card as the default payment method for all future payments?
              </p>
              <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-6 rounded bg-indigo-100 flex items-center justify-center">
                    <CreditCard className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      <span className="capitalize">{confirmModal.pm.card?.brand}</span>
                      {' •••• '}
                      {confirmModal.pm.card?.last4}
                    </p>
                    <p className="text-xs text-gray-500">
                      Expires {confirmModal.pm.card?.exp_month.toString().padStart(2, '0')}/{confirmModal.pm.card?.exp_year}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {confirmModal.type === 'batchDelete' && (
            <>
              <p className="text-gray-600">
                Are you sure you want to delete {selectedIds.length} payment method{selectedIds.length !== 1 ? 's' : ''}?
              </p>
              <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="text-sm text-red-700">
                  This action cannot be undone.
                </p>
              </div>
            </>
          )}

          <ModalFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmModal({ isOpen: false, type: 'delete', pm: null })}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              variant={confirmModal.type === 'default' ? 'primary' : 'danger'}
              onClick={handleConfirmAction}
              loading={actionLoading}
            >
              {confirmModal.type === 'delete' && (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete
                </>
              )}
              {confirmModal.type === 'default' && (
                <>
                  <Star className="w-4 h-4" />
                  Set as Default
                </>
              )}
              {confirmModal.type === 'batchDelete' && (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete {selectedIds.length} Card{selectedIds.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </Card>
  );
}
