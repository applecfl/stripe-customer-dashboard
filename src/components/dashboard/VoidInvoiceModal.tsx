'use client';

import { useState } from 'react';
import { InvoiceData } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Modal, ModalFooter, Button, Textarea } from '@/components/ui';
import { XCircle } from 'lucide-react';

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
        addCredit: false, // Never add credit - it affects other draft invoices
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
