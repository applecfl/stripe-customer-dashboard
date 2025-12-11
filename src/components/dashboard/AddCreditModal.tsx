'use client';

import { useState } from 'react';
import { Modal, ModalFooter, Button, Input, Textarea } from '@/components/ui';
import { Plus, Wallet, FileText } from 'lucide-react';
import { InvoiceData } from '@/types';
import { formatCurrency } from '@/lib/utils';

interface AddCreditModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  invoices: InvoiceData[];
  invoiceUID: string;
  currency: string;
  onSuccess: () => void;
}

export function AddCreditModal({
  isOpen,
  onClose,
  customerId,
  invoices,
  invoiceUID,
  currency,
  onSuccess,
}: AddCreditModalProps) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [applyToAll, setApplyToAll] = useState(true);

  // Show open and draft invoices with remaining balance
  // For draft invoices, calculate effective remaining = amount_due - totalPaid from metadata
  const payableInvoices = invoices.filter(inv => {
    if (inv.status === 'open' && inv.amount_remaining > 0) return true;
    if (inv.status === 'draft') {
      const metadataTotalPaid = inv.metadata?.totalPaid ? parseInt(inv.metadata.totalPaid) : 0;
      const effectiveRemaining = inv.amount_due - metadataTotalPaid;
      return effectiveRemaining > 0;
    }
    return false;
  });

  // Calculate total selected amount (using effective remaining for draft invoices)
  const selectedTotal = selectedInvoiceIds.reduce((sum, id) => {
    const inv = payableInvoices.find(i => i.id === id);
    if (!inv) return sum;
    if (inv.status === 'draft') {
      const metadataTotalPaid = inv.metadata?.totalPaid ? parseInt(inv.metadata.totalPaid) : 0;
      return sum + Math.max(0, inv.amount_due - metadataTotalPaid);
    }
    return sum + (inv.amount_remaining || 0);
  }, 0);

  const handleInvoiceToggle = (invoiceId: string) => {
    setSelectedInvoiceIds(prev =>
      prev.includes(invoiceId)
        ? prev.filter(id => id !== invoiceId)
        : [...prev, invoiceId]
    );
    setApplyToAll(false);
  };

  const handleSelectAll = () => {
    if (applyToAll) {
      setSelectedInvoiceIds([]);
      setApplyToAll(false);
    } else {
      setSelectedInvoiceIds(payableInvoices.map(inv => inv.id));
      setApplyToAll(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const creditAmount = Math.round(parseFloat(amount) * 100);

    if (!amount || creditAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!reason.trim()) {
      setError('Please enter a reason/note for this credit');
      return;
    }

    // Require at least one invoice to be selected
    if (payableInvoices.length > 0 && !applyToAll && selectedInvoiceIds.length === 0) {
      setError('Please select at least one invoice to apply the credit to');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/stripe/add-credit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          amount: creditAmount,
          currency,
          reason,
          invoiceUID,
          selectedInvoiceIds: selectedInvoiceIds.length > 0 ? selectedInvoiceIds : null,
          applyToAll,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      onSuccess();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add credit');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setAmount('');
    setReason('');
    setSelectedInvoiceIds([]);
    setApplyToAll(true);
    setError('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Customer Credit" size="lg">
      <form onSubmit={handleSubmit}>
        {/* Info */}
        <div className="bg-green-50 rounded-xl p-4 mb-6 border border-green-200">
          <div className="flex items-start gap-3">
            <Wallet className="w-5 h-5 text-green-600 mt-0.5" />
            <div>
              <p className="font-medium text-green-800">Add Credit to Customer</p>
              <p className="text-sm text-green-600 mt-1">
                Credit will be applied to selected invoices. Please select at least one invoice.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Amount */}
          <Input
            label="Credit Amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          {/* Reason/Note */}
          <Textarea
            label="Credit Reason/Note (required)"
            placeholder="Enter a reason or note for this credit..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />

          {/* Invoice Selection */}
          {payableInvoices.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Apply to Invoices
                </label>
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-xs text-indigo-600 hover:text-indigo-700"
                >
                  {applyToAll || selectedInvoiceIds.length === payableInvoices.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {payableInvoices.map((invoice) => {
                  // Calculate effective remaining for draft invoices
                  const metadataTotalPaid = invoice.metadata?.totalPaid ? parseInt(invoice.metadata.totalPaid) : 0;
                  const effectiveRemaining = invoice.status === 'draft'
                    ? Math.max(0, invoice.amount_due - metadataTotalPaid)
                    : invoice.amount_remaining;
                  return (
                    <label
                      key={invoice.id}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedInvoiceIds.includes(invoice.id) || applyToAll}
                        onChange={() => handleInvoiceToggle(invoice.id)}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <FileText className="w-4 h-4 text-gray-400" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {invoice.number || invoice.id.slice(0, 12)}
                          </p>
                          {invoice.status === 'draft' && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">Draft</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          Remaining: {formatCurrency(effectiveRemaining, invoice.currency)}
                          {metadataTotalPaid > 0 && (
                            <span className="text-green-600 ml-1">(paid: {formatCurrency(metadataTotalPaid, invoice.currency)})</span>
                          )}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
              {(selectedInvoiceIds.length > 0 || applyToAll) && (
                <p className="text-xs text-gray-500 mt-2">
                  Total to apply to invoices: {formatCurrency(applyToAll ? payableInvoices.reduce((sum, inv) => {
                    const metaPaid = inv.metadata?.totalPaid ? parseInt(inv.metadata.totalPaid) : 0;
                    return sum + (inv.status === 'draft' ? Math.max(0, inv.amount_due - metaPaid) : inv.amount_remaining);
                  }, 0) : selectedTotal, currency)}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Credit is applied sequentially (first invoice, then second, etc.).
                {selectedInvoiceIds.length > 0 && ' Remaining credit stays on account.'}
                {' Draft invoices will be finalized.'}
              </p>
            </div>
          )}

          {payableInvoices.length === 0 && (
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <p className="text-sm text-amber-700">
                No open or draft invoices available. Credit can only be added when there are invoices to apply it to.
              </p>
            </div>
          )}

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
          <Button type="submit" loading={loading} disabled={payableInvoices.length === 0}>
            <Plus className="w-4 h-4" />
            Add Credit
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
