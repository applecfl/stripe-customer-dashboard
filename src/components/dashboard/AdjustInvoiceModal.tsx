'use client';

import { useState } from 'react';
import { InvoiceData } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Modal, ModalFooter, Button, Input, Textarea } from '@/components/ui';
import { Edit3 } from 'lucide-react';

interface AdjustInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceData | null;
  onAdjust: (data: {
    invoiceId: string;
    newAmount: number;
    reason: string;
  }) => Promise<void>;
}

export function AdjustInvoiceModal({
  isOpen,
  onClose,
  invoice,
  onAdjust,
}: AdjustInvoiceModalProps) {
  const [newAmount, setNewAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;

    const adjustedAmount = Math.round(parseFloat(newAmount) * 100);

    if (!newAmount || adjustedAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!reason.trim()) {
      setError('Please provide a reason for the adjustment');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onAdjust({
        invoiceId: invoice.id,
        newAmount: adjustedAmount,
        reason: reason.trim(),
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adjust invoice');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setNewAmount('');
    setReason('');
    setError('');
    onClose();
  };

  if (!invoice) return null;

  const difference = newAmount
    ? invoice.amount_due - Math.round(parseFloat(newAmount) * 100)
    : 0;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Adjust Invoice Amount" size="md">
      <form onSubmit={handleSubmit}>
        {/* Invoice Summary */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Invoice</span>
            <span className="font-mono text-sm">{invoice.number || invoice.id.slice(0, 12)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Current Amount</span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(invoice.amount_due, invoice.currency)}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {/* New Amount */}
          <Input
            label="New Amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder={(invoice.amount_due / 100).toFixed(2)}
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            error={error && !newAmount ? 'Please enter a valid amount' : undefined}
          />

          {/* Difference Preview */}
          {newAmount && difference !== 0 && (
            <div
              className={`rounded-xl p-4 border ${
                difference > 0
                  ? 'bg-green-50 border-green-200'
                  : 'bg-amber-50 border-amber-200'
              }`}
            >
              <p className={`text-sm ${difference > 0 ? 'text-green-700' : 'text-amber-700'}`}>
                {difference > 0 ? 'Decreasing' : 'Increasing'} by{' '}
                <span className="font-semibold">
                  {formatCurrency(Math.abs(difference), invoice.currency)}
                </span>
              </p>
            </div>
          )}

          {/* Reason */}
          <Textarea
            label="Reason for Adjustment"
            placeholder="Enter the reason for this adjustment..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            error={error && !reason.trim() ? 'Please provide a reason' : undefined}
          />

          {error && newAmount && reason.trim() && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            <Edit3 className="w-4 h-4" />
            Adjust Invoice
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
