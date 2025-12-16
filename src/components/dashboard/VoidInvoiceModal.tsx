'use client';

import { useState } from 'react';
import { InvoiceData } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Modal, ModalFooter, Button, Textarea } from '@/components/ui';
import { XCircle, Wallet } from 'lucide-react';

interface VoidInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceData | null;
  onVoid: (data: {
    invoiceId: string;
    addCredit: boolean;
    reason?: string;
  }) => Promise<void>;
}

export function VoidInvoiceModal({
  isOpen,
  onClose,
  invoice,
  onVoid,
}: VoidInvoiceModalProps) {
  const [addCredit, setAddCredit] = useState(true);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;

    setLoading(true);
    setError('');

    try {
      await onVoid({
        invoiceId: invoice.id,
        addCredit,
        reason: reason || undefined,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to void payment');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setAddCredit(true);
    setReason('');
    setError('');
    onClose();
  };

  if (!invoice) return null;

  // Format title with date and amount like other modals
  const title = `Void Payment: ${formatDate(invoice.due_date || invoice.created)} - ${formatCurrency(invoice.amount_due, invoice.currency)}`;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="md">
      <form onSubmit={handleSubmit}>
        {/* Warning */}
        <div className="bg-red-50 rounded-xl p-4 mb-6 border border-red-200">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium text-red-800">
                Are you sure you want to void this payment?
              </p>
              <p className="text-sm text-red-600 mt-1">
                This action cannot be undone. The payment will be marked as void.
              </p>
            </div>
          </div>
        </div>

        {/* Invoice Summary */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Date</span>
            <span className="text-sm text-gray-700">{formatDate(invoice.due_date || invoice.created)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Amount</span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(invoice.amount_due, invoice.currency)}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {/* Add Credit Option */}
          <div className="bg-green-50 rounded-xl p-4 border border-green-200">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={addCredit}
                onChange={(e) => setAddCredit(e.target.checked)}
                className="mt-1 w-4 h-4 text-green-600 rounded border-gray-300 focus:ring-green-500"
              />
              <div>
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-green-600" />
                  <p className="font-medium text-green-800">
                    Add remaining amount as credit
                  </p>
                </div>
                <p className="text-sm text-green-600 mt-0.5">
                  {formatCurrency(invoice.amount_remaining, invoice.currency)} will be added
                  to the customer&apos;s credit balance.
                </p>
              </div>
            </label>
          </div>

          {/* Reason */}
          <Textarea
            label="Reason (optional)"
            placeholder="Enter the reason for voiding this payment..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />

          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={loading}>
            <XCircle className="w-4 h-4" />
            Void Payment
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
