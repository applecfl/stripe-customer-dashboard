'use client';

import { useState, useEffect } from 'react';
import { InvoiceData } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Modal, ModalFooter, Button, Input } from '@/components/ui';
import { Calendar } from 'lucide-react';

interface ChangeDueDateModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceData | null;
  invoices?: InvoiceData[]; // For bulk mode
  onChangeDueDate: (invoiceIds: string[], newFinalizationDate: number) => Promise<void>;
  mode?: 'single' | 'bulk';
}

export function ChangeDueDateModal({
  isOpen,
  onClose,
  invoice,
  invoices = [],
  onChangeDueDate,
  mode = 'single',
}: ChangeDueDateModalProps) {
  const [finalizationDate, setFinalizationDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Get the invoices to update
  const targetInvoices = mode === 'bulk'
    ? invoices.filter(inv => inv.status === 'draft')
    : invoice ? [invoice] : [];

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      // Default to current finalization date or 7 days from now
      const defaultDate = invoice?.automatically_finalizes_at
        ? new Date(invoice.automatically_finalizes_at * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      setFinalizationDate(defaultDate.toISOString().split('T')[0]);
      setError('');
    }
  }, [isOpen, invoice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!finalizationDate) {
      setError('Please select a finalization date');
      return;
    }

    const newFinalizationTimestamp = Math.floor(new Date(finalizationDate).getTime() / 1000);

    setLoading(true);
    setError('');

    try {
      const invoiceIds = targetInvoices.map(inv => inv.id);
      await onChangeDueDate(invoiceIds, newFinalizationTimestamp);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update finalization date');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFinalizationDate('');
    setError('');
    onClose();
  };

  if (targetInvoices.length === 0) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={mode === 'bulk' ? 'Schedule All Drafts' : 'Schedule Finalization'}
      size="md"
    >
      <form onSubmit={handleSubmit}>
        {/* Invoice Summary */}
        {mode === 'single' && invoice && (
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Invoice</span>
              <span className="font-mono text-sm">{invoice.number || invoice.id.slice(0, 12)}</span>
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">Amount</span>
              <span className="font-semibold">
                {formatCurrency(invoice.amount_due, invoice.currency)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Currently Scheduled</span>
              <span className="font-medium text-gray-700">
                {invoice.automatically_finalizes_at ? formatDate(invoice.automatically_finalizes_at) : 'Not scheduled'}
              </span>
            </div>
          </div>
        )}

        {mode === 'bulk' && (
          <div className="bg-indigo-50 rounded-xl p-4 mb-6 border border-indigo-200">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-indigo-600 mt-0.5" />
              <div>
                <p className="font-medium text-indigo-800">
                  Scheduling {targetInvoices.length} draft invoice{targetInvoices.length !== 1 ? 's' : ''}
                </p>
                <p className="text-sm text-indigo-600 mt-1">
                  This will set when the invoices will be automatically finalized.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {/* Finalization Date Input */}
          <Input
            label="Finalization Date"
            type="date"
            value={finalizationDate}
            onChange={(e) => setFinalizationDate(e.target.value)}
            hint="The invoice will be automatically finalized on this date"
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
          <Button type="submit" loading={loading}>
            <Calendar className="w-4 h-4" />
            {mode === 'bulk' ? 'Schedule All' : 'Schedule'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
