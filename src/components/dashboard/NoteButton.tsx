'use client';

import { useState } from 'react';
import { StickyNote, Loader2 } from 'lucide-react';
import { InvoiceData } from '@/types';
import { Modal, ModalFooter, Button, Textarea } from '@/components/ui';
import { formatCurrency, formatDate } from '@/lib/utils';

interface NoteButtonProps {
  invoice: InvoiceData;
  token?: string;
  accountId?: string;
  onNoteUpdated?: () => void;
  size?: 'sm' | 'md';
}

export function NoteButton({
  invoice,
  token,
  accountId,
  onNoteUpdated,
  size = 'sm',
}: NoteButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [note, setNote] = useState(invoice.note || '');
  const [saving, setSaving] = useState(false);

  const hasNote = !!invoice.note;
  const hasChanges = note !== (invoice.note || '');

  const openModal = () => {
    setNote(invoice.note || '');
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    setNote(invoice.note || '');
  };

  const saveNote = async () => {
    if (!hasChanges) {
      closeModal();
      return;
    }

    setSaving(true);
    try {
      let url = `/api/stripe/invoices/${invoice.id}`;
      if (token) {
        url += `?token=${encodeURIComponent(token)}`;
      }

      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-note',
          note: note.trim(),
          accountId,
        }),
      });

      if (response.ok) {
        closeModal();
        onNoteUpdated?.();
      } else {
        const data = await response.json();
        console.error('Failed to save note:', data.error);
      }
    } catch (error) {
      console.error('Error saving note:', error);
    } finally {
      setSaving(false);
    }
  };

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <>
      {/* Note Button - styled like other action buttons */}
      <button
        onClick={openModal}
        className={`inline-flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium rounded-md transition-colors ${
          hasNote
            ? 'text-amber-700 bg-amber-50 hover:bg-amber-100'
            : 'text-gray-700 bg-gray-100 hover:bg-gray-200'
        }`}
        title={hasNote ? invoice.note : 'Add note'}
      >
        <StickyNote className={iconSize} />
        <span className="hidden sm:inline">Note</span>
      </button>

      {/* Note Modal */}
      <Modal
        isOpen={isOpen}
        onClose={closeModal}
        title="Invoice Note"
        size="sm"
      >
        <div className="space-y-4">
          {/* Invoice Info */}
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Amount</span>
              <span className="font-semibold text-gray-900">
                {formatCurrency(invoice.amount_due, invoice.currency)}
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-sm text-gray-500">Date</span>
              <span className="text-sm text-gray-700">
                {formatDate(invoice.created)}
              </span>
            </div>
          </div>

          <Textarea
            label="Note"
            placeholder="Add a note for this invoice..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />

          <ModalFooter>
            <Button variant="outline" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveNote} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <StickyNote className="w-4 h-4" />
                  Save Note
                </>
              )}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </>
  );
}
