'use client';

import { useState } from 'react';
import { PaymentData } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Modal, ModalFooter, Button, Input, Select, Textarea } from '@/components/ui';
import { RotateCcw, AlertTriangle } from 'lucide-react';

interface RefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  payment: PaymentData | null;
  onRefund: (data: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
    note?: string;
  }) => Promise<void>;
}

const REFUND_REASONS = [
  { value: '', label: 'Select a reason (optional)' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'fraudulent', label: 'Fraudulent' },
  { value: 'requested_by_customer', label: 'Requested by Customer' },
];

export function RefundModal({
  isOpen,
  onClose,
  payment,
  onRefund,
}: RefundModalProps) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payment) return;

    // Require confirmation checkbox
    if (!confirmed) {
      setError('Please confirm you want to process this refund');
      return;
    }

    const refundAmount = amount ? Math.round(parseFloat(amount) * 100) : undefined;
    const maxRefundable = payment.amount - payment.amount_refunded;

    if (refundAmount && refundAmount <= 0) {
      setError('Amount must be greater than 0');
      return;
    }

    if (refundAmount && refundAmount > maxRefundable) {
      setError('Amount cannot exceed refundable amount');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onRefund({
        paymentIntentId: payment.id,
        amount: refundAmount,
        reason: reason || undefined,
        note: note || undefined,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process refund');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setAmount('');
    setReason('');
    setNote('');
    setConfirmed(false);
    setError('');
    onClose();
  };

  if (!payment) return null;

  const maxRefundable = payment.amount - payment.amount_refunded;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Refund Payment" size="md">
      <form onSubmit={handleSubmit}>
        {/* Warning */}
        <div className="bg-amber-50 rounded-xl p-4 mb-6 border border-amber-200">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800">
                Refund Confirmation Required
              </p>
              <p className="text-sm text-amber-600 mt-1">
                This action will refund the payment. Please review the details carefully before proceeding.
              </p>
            </div>
          </div>
        </div>

        {/* Payment Summary */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Payment Intent</span>
            <span className="font-mono text-sm">{payment.id.slice(0, 20)}...</span>
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Original Amount</span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(payment.amount, payment.currency)}
            </span>
          </div>
          {payment.amount_refunded > 0 && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Already Refunded</span>
              <span className="text-indigo-600">
                {formatCurrency(payment.amount_refunded, payment.currency)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between pt-3 border-t border-gray-200">
            <span className="text-sm text-gray-500">Refundable Amount</span>
            <span className="font-semibold text-green-600">
              {formatCurrency(maxRefundable, payment.currency)}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          {/* Refund Amount */}
          <Input
            label="Refund Amount"
            type="number"
            step="0.01"
            min="0.01"
            max={(maxRefundable / 100).toFixed(2)}
            placeholder={(maxRefundable / 100).toFixed(2)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint="Leave empty for full refund"
          />

          {/* Refund Reason */}
          <Select
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            options={REFUND_REASONS}
          />

          {/* Internal Note */}
          <Textarea
            label="Internal Note (optional)"
            placeholder="Add a note for internal reference..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />

          {/* Confirmation Checkbox */}
          <label className="flex items-start gap-3 cursor-pointer p-3 bg-gray-50 rounded-lg border border-gray-200">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
            />
            <span className="text-sm text-gray-700">
              I confirm that I want to refund{' '}
              <span className="font-semibold">
                {amount ? formatCurrency(parseFloat(amount) * 100, payment.currency) : formatCurrency(maxRefundable, payment.currency)}
              </span>{' '}
              to this customer.
            </span>
          </label>

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
          <Button type="submit" loading={loading} disabled={!confirmed}>
            <RotateCcw className="w-4 h-4" />
            Refund {amount ? formatCurrency(parseFloat(amount) * 100, payment.currency) : 'Full Amount'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
