'use client';

import { useState, useRef, useEffect } from 'react';
import { InvoiceData, PaymentMethodData } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Card,
  CardHeader,
  CardContent,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Modal,
  ModalFooter,
  Button,
  Textarea,
  Tooltip,
} from '@/components/ui';
import {
  Clock,
  Copy,
  Check,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Calendar,
  Loader2,
  X,
  Save,
  ExternalLink,
  Trash2,
  CheckSquare,
  Square,
  MinusSquare,
  Pause,
  Play,
  Hash,
  Plus,
  StickyNote,
} from 'lucide-react';

interface FutureInvoicesTableProps {
  invoices: InvoiceData[];
  paymentMethods?: PaymentMethodData[];
  token?: string;
  accountId?: string;
  onRefresh: () => void;
  onUpdatingChange?: (isUpdating: boolean) => void;
  onAddCard?: () => void;
  // Keep old props for compatibility but we won't use them
  onChangeDueDate?: (invoice: InvoiceData) => void;
  onAdjustAmount?: (invoice: InvoiceData) => void;
  onChangePaymentMethod?: (invoice: InvoiceData) => void;
  onPauseInvoice?: (invoice: InvoiceData, pause: boolean) => void;
  onDeleteInvoice?: (invoice: InvoiceData) => void;
  onBulkChangeDueDate?: () => void;
  onBulkChangePaymentMethod?: () => void;
  onBulkPause?: (pause: boolean) => void;
  onBulkDelete?: (invoiceIds: string[]) => void;
}

// Track pending changes for each invoice
interface PendingChanges {
  amount?: number; // in cents
  date?: number; // unix timestamp
  paymentMethodId?: string;
  note?: string; // note text
}

export function FutureInvoicesTable({
  invoices,
  paymentMethods = [],
  token,
  accountId,
  onRefresh,
  onUpdatingChange,
  onAddCard,
}: FutureInvoicesTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Track pending changes per invoice
  const [pendingChanges, setPendingChanges] = useState<Record<string, PendingChanges>>({});

  // UI state for editing (which field is currently being edited)
  const [editingAmount, setEditingAmount] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [noteEditValue, setNoteEditValue] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Delete confirmation modal state
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    invoiceIds: string[];
    isBulk: boolean;
  }>({ isOpen: false, invoiceIds: [], isBulk: false });
  const [deleting, setDeleting] = useState(false);

  // Bulk edit modals state
  const [bulkAmountModal, setBulkAmountModal] = useState(false);
  const [bulkDateModal, setBulkDateModal] = useState(false);
  const [bulkCardModal, setBulkCardModal] = useState(false);
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  // Pause/Resume state
  const [pausingId, setPausingId] = useState<string | null>(null);

  // Pause confirmation modal state
  const [pauseModal, setPauseModal] = useState<{
    isOpen: boolean;
    invoiceId: string | null;
    invoice: InvoiceData | null;
  }>({ isOpen: false, invoiceId: null, invoice: null });
  const [pauseReason, setPauseReason] = useState('');

  const amountInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Helper to add token to API URLs
  const withToken = (url: string) => {
    if (!token) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  };

  const copyToClipboard = async (id: string) => {
    await navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Parse date from note's [Scheduled: ...] pattern
  // Defined early so it can be used by getFinalizeDate and other functions
  const parseDateFromNote = (note: string): number | null => {
    const match = note.match(/\[Scheduled: ([^\]]+)\]/);
    if (match) {
      const dateStr = match[1];
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        return Math.floor(parsed.getTime() / 1000);
      }
    }
    return null;
  };

  // Helper to get Payment date for sorting (prioritize metadata.scheduledFinalizeAt)
  // For paused invoices, check note and originalScheduledDate
  const getFinalizeDate = (inv: InvoiceData): number => {
    if (inv.isPaused) {
      const noteDate = parseDateFromNote(inv.note || '');
      if (noteDate) return noteDate;
      if (inv.metadata?.originalScheduledDate) return parseInt(inv.metadata.originalScheduledDate, 10);
    }
    if (inv.metadata?.scheduledFinalizeAt) return parseInt(inv.metadata.scheduledFinalizeAt, 10);
    if (inv.automatically_finalizes_at) return inv.automatically_finalizes_at;
    return inv.due_date || inv.created;
  };

  // Filter to only draft invoices - show all in one table sorted by date
  const allDraftInvoices = invoices.filter(inv => inv.status === 'draft');

  // Sort all draft invoices by date (closest to charge first)
  const draftInvoices = allDraftInvoices
    .sort((a, b) => {
      // Sort by date - closest to charge first (ascending order)
      // This applies to both active and paused invoices
      return getFinalizeDate(a) - getFinalizeDate(b);
    });

  // Create a map for quick payment method lookup
  const paymentMethodMap = new Map(paymentMethods.map(pm => [pm.id, pm]));

  // Get payment method for an invoice
  const getPaymentMethod = (invoice: InvoiceData): PaymentMethodData | null => {
    if (invoice.default_payment_method) {
      return paymentMethodMap.get(invoice.default_payment_method) || null;
    }
    return paymentMethods.find(pm => pm.isDefault) || null;
  };

  // Get current displayed payment method (pending change or original)
  const getDisplayedPaymentMethod = (invoice: InvoiceData): PaymentMethodData | null => {
    const changes = pendingChanges[invoice.id];
    if (changes?.paymentMethodId) {
      return paymentMethodMap.get(changes.paymentMethodId) || null;
    }
    return getPaymentMethod(invoice);
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingAmount && amountInputRef.current) {
      amountInputRef.current.focus();
      amountInputRef.current.select();
    }
  }, [editingAmount]);

  useEffect(() => {
    if (editingDate && dateInputRef.current) {
      dateInputRef.current.focus();
    }
  }, [editingDate]);

  // Get the original scheduled date from invoice (before any pending changes)
  // Prioritize metadata.scheduledFinalizeAt since that's where we store user's custom date
  // For paused invoices, use note's scheduled date or originalScheduledDate from metadata
  const getOriginalDate = (invoice: InvoiceData): number | null => {
    // For paused invoices, first check note, then metadata
    if (invoice.isPaused) {
      const noteDate = parseDateFromNote(invoice.note || '');
      if (noteDate) return noteDate;
      if (invoice.metadata?.originalScheduledDate) {
        return parseInt(invoice.metadata.originalScheduledDate, 10);
      }
    }
    if (invoice.metadata?.scheduledFinalizeAt) return parseInt(invoice.metadata.scheduledFinalizeAt, 10);
    if (invoice.automatically_finalizes_at) return invoice.automatically_finalizes_at;
    return invoice.due_date || invoice.created || null;
  };

  // Check if invoice has pending changes
  const hasChanges = (invoice: InvoiceData): boolean => {
    const changes = pendingChanges[invoice.id];
    if (!changes) return false;

    const amountChanged = changes.amount !== undefined && changes.amount !== invoice.amount_due;
    const originalDate = getOriginalDate(invoice);
    const dateChanged = changes.date !== undefined && changes.date !== originalDate;
    const pmChanged = changes.paymentMethodId !== undefined && changes.paymentMethodId !== invoice.default_payment_method;
    const noteChanged = changes.note !== undefined && changes.note !== (invoice.note || '');

    return amountChanged || dateChanged || pmChanged || noteChanged;
  };

  // Start editing amount
  const startEditAmount = (invoice: InvoiceData) => {
    const currentAmount = pendingChanges[invoice.id]?.amount ?? invoice.amount_due;
    setEditingAmount(invoice.id);
    setEditValue((currentAmount / 100).toFixed(2));
  };

  // Finish editing amount (on blur)
  const finishEditAmount = (invoice: InvoiceData) => {
    const newAmount = Math.round(parseFloat(editValue) * 100);
    if (!isNaN(newAmount) && newAmount > 0 && newAmount !== invoice.amount_due) {
      setPendingChanges(prev => ({
        ...prev,
        [invoice.id]: { ...prev[invoice.id], amount: newAmount },
      }));
    }
    setEditingAmount(null);
  };

  // Start editing date
  const startEditDate = (invoice: InvoiceData) => {
    const currentDate = pendingChanges[invoice.id]?.date ?? getOriginalDate(invoice);
    setEditingDate(invoice.id);
    setEditValue(formatDateForInput(currentDate));
  };

  // Finish editing date (on blur)
  // For paused invoices, store the new date in the note instead of the real date field
  const finishEditDate = (invoice: InvoiceData) => {
    const newDate = new Date(editValue + 'T00:00:00');
    if (!isNaN(newDate.getTime())) {
      const timestamp = Math.floor(newDate.getTime() / 1000);
      const originalDate = getOriginalDate(invoice);
      // Compare dates by day only (ignore time differences)
      const originalDateOnly = originalDate ? Math.floor(new Date(originalDate * 1000).setHours(0, 0, 0, 0) / 1000) : null;
      const newDateOnly = Math.floor(new Date(timestamp * 1000).setHours(0, 0, 0, 0) / 1000);

      console.log('Date comparison:', { editValue, timestamp, originalDate, originalDateOnly, newDateOnly, changed: newDateOnly !== originalDateOnly, isPaused: invoice.isPaused });

      if (newDateOnly !== originalDateOnly) {
        if (invoice.isPaused) {
          // For paused invoices, update the note with the new date instead of the real date
          // This way the date change is stored in metadata until resumed
          const currentNote = getDisplayedNote(invoice);
          const dateStr = formatDate(timestamp);
          // Check if note already has a scheduled date pattern and replace it, otherwise prepend
          const scheduledDatePattern = /\[Scheduled: [^\]]+\]/;
          const newScheduledDate = `[Scheduled: ${dateStr}]`;
          let newNote: string;
          if (scheduledDatePattern.test(currentNote)) {
            newNote = currentNote.replace(scheduledDatePattern, newScheduledDate);
          } else {
            newNote = currentNote ? `${newScheduledDate} ${currentNote}` : newScheduledDate;
          }
          setPendingChanges(prev => ({
            ...prev,
            [invoice.id]: { ...prev[invoice.id], note: newNote },
          }));
        } else {
          setPendingChanges(prev => ({
            ...prev,
            [invoice.id]: { ...prev[invoice.id], date: timestamp },
          }));
        }
      }
    }
    setEditingDate(null);
  };

  // Handle payment method change
  const handlePaymentMethodChange = (invoiceId: string, paymentMethodId: string) => {
    setPendingChanges(prev => ({
      ...prev,
      [invoiceId]: { ...prev[invoiceId], paymentMethodId },
    }));
    setEditingCard(null);
  };

  // Cancel changes for an invoice
  const cancelChanges = (invoiceId: string) => {
    setPendingChanges(prev => {
      const newChanges = { ...prev };
      delete newChanges[invoiceId];
      return newChanges;
    });
  };

  // Save all changes for an invoice
  const saveChanges = async (invoice: InvoiceData) => {
    const changes = pendingChanges[invoice.id];
    if (!changes) return;

    setSaving(invoice.id);
    setError(null);

    try {
      const originalDate = getOriginalDate(invoice);

      // Save amount if changed
      if (changes.amount !== undefined && changes.amount !== invoice.amount_due) {
        const res = await fetch(withToken('/api/stripe/invoices/adjust'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoice.id,
            newAmount: changes.amount,
            accountId,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to update amount');
        }
      }

      // Save date if changed
      console.log('Checking date change:', { changesDate: changes.date, originalDate, shouldSave: changes.date !== undefined && changes.date !== originalDate });
      if (changes.date !== undefined && changes.date !== originalDate) {
        console.log('Saving date change:', { invoiceId: invoice.id, scheduledDate: changes.date });
        const res = await fetch(withToken('/api/stripe/invoices/schedule'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoice.id,
            scheduledDate: changes.date,
            accountId,
          }),
        });
        const data = await res.json();
        console.log('Schedule API response:', data);
        if (!data.success) {
          throw new Error(data.error || 'Failed to update Payment date');
        }
      }

      // Save payment method if changed
      if (changes.paymentMethodId !== undefined && changes.paymentMethodId !== invoice.default_payment_method) {
        const res = await fetch(withToken('/api/stripe/invoices/payment-method'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoice.id,
            paymentMethodId: changes.paymentMethodId,
            accountId,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to update payment method');
        }
      }

      // Save note if changed
      if (changes.note !== undefined && changes.note !== (invoice.note || '')) {
        const res = await fetch(withToken(`/api/stripe/invoices/${invoice.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update-note',
            note: changes.note.trim(),
            accountId,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to update note');
        }
      }

      // Clear pending changes for this invoice
      cancelChanges(invoice.id);
      onRefresh();
    } catch (err) {
      console.error('Failed to save changes:', err);
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(null);
    }
  };

  // Save only the note for an invoice
  const saveNoteOnly = async (invoice: InvoiceData) => {
    const changes = pendingChanges[invoice.id];
    if (!changes?.note || changes.note === (invoice.note || '')) return;

    setSaving(invoice.id);
    setError(null);

    try {
      const res = await fetch(withToken(`/api/stripe/invoices/${invoice.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-note',
          note: changes.note.trim(),
          accountId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to update note');
      }

      // Clear only the note from pending changes
      setPendingChanges(prev => {
        const updated = { ...prev };
        if (updated[invoice.id]) {
          const { note: _, ...rest } = updated[invoice.id];
          if (Object.keys(rest).length === 0) {
            delete updated[invoice.id];
          } else {
            updated[invoice.id] = rest;
          }
        }
        return updated;
      });
      onRefresh();
    } catch (err) {
      console.error('Failed to save note:', err);
      setError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setSaving(null);
    }
  };

  // Cancel only the note change for an invoice
  const cancelNoteOnly = (invoiceId: string) => {
    setPendingChanges(prev => {
      const updated = { ...prev };
      if (updated[invoiceId]) {
        const { note: _, ...rest } = updated[invoiceId];
        if (Object.keys(rest).length === 0) {
          delete updated[invoiceId];
        } else {
          updated[invoiceId] = rest;
        }
      }
      return updated;
    });
  };

  // Get displayed amount (pending or original)
  // For draft invoices, amount_due might be 0 - use line items total as fallback
  const getDisplayedAmount = (invoice: InvoiceData): number => {
    if (pendingChanges[invoice.id]?.amount !== undefined) {
      return pendingChanges[invoice.id].amount;
    }
    // If amount_due is 0, calculate from line items
    if (invoice.amount_due === 0 && invoice.lines && invoice.lines.length > 0) {
      return invoice.lines.reduce((sum, line) => sum + line.amount, 0);
    }
    return invoice.amount_due;
  };

  // Get displayed date (pending or original)
  // Prioritize metadata.scheduledFinalizeAt since that's where we store user's custom date
  // For paused invoices, use originalScheduledDate from metadata or note
  const getDisplayedDate = (invoice: InvoiceData): number | null => {
    const changes = pendingChanges[invoice.id];
    if (changes?.date !== undefined) return changes.date;

    // For paused invoices, first check if there's a scheduled date in the note
    if (invoice.isPaused) {
      const noteDate = parseDateFromNote(invoice.note || '');
      if (noteDate) return noteDate;
      // Fall back to originalScheduledDate from metadata
      if (invoice.metadata?.originalScheduledDate) {
        return parseInt(invoice.metadata.originalScheduledDate, 10);
      }
    }
    // Check multiple sources - prioritize our custom metadata field
    if (invoice.metadata?.scheduledFinalizeAt) return parseInt(invoice.metadata.scheduledFinalizeAt, 10);
    if (invoice.automatically_finalizes_at) return invoice.automatically_finalizes_at;
    return invoice.due_date || invoice.created || null;
  };

  // Get displayed note (pending or original)
  const getDisplayedNote = (invoice: InvoiceData): string => {
    const changes = pendingChanges[invoice.id];
    if (changes?.note !== undefined) return changes.note;
    return invoice.note || '';
  };

  // Handle note change
  const handleNoteChange = (invoiceId: string, newNote: string) => {
    setPendingChanges(prev => ({
      ...prev,
      [invoiceId]: {
        ...prev[invoiceId],
        note: newNote,
      },
    }));
  };

  // Start editing note
  const startEditNote = (invoice: InvoiceData) => {
    const currentNote = getDisplayedNote(invoice);
    setNoteEditValue(currentNote);
    setEditingNote(invoice.id);
  };

  // Handle note input change - apply to pending changes immediately
  const handleNoteInputChange = (invoice: InvoiceData, newValue: string) => {
    setNoteEditValue(newValue);
    handleNoteChange(invoice.id, newValue);
  };

  // Close note editor (on blur or escape)
  const closeNoteEditor = () => {
    setEditingNote(null);
    setNoteEditValue('');
  };

  // Format date for input
  const formatDateForInput = (timestamp: number | null): string => {
    if (!timestamp) return new Date().toISOString().split('T')[0];
    return new Date(timestamp * 1000).toISOString().split('T')[0];
  };

  // Handle key events
  const handleKeyDown = (e: React.KeyboardEvent, invoice: InvoiceData, type: 'amount' | 'date') => {
    if (e.key === 'Enter') {
      if (type === 'amount') finishEditAmount(invoice);
      else finishEditDate(invoice);
    } else if (e.key === 'Escape') {
      setEditingAmount(null);
      setEditingDate(null);
    }
  };

  // Selection helpers
  const toggleSelect = (invoiceId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(invoiceId)) {
        newSet.delete(invoiceId);
      } else {
        newSet.add(invoiceId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === draftInvoices.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(draftInvoices.map(inv => inv.id)));
    }
  };

  const isAllSelected = draftInvoices.length > 0 && selectedIds.size === draftInvoices.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < draftInvoices.length;

  // Delete invoice(s)
  const handleDelete = async () => {
    if (deleteModal.invoiceIds.length === 0) return;

    setDeleting(true);
    setError(null);

    try {
      for (const invoiceId of deleteModal.invoiceIds) {
        const url = withToken(`/api/stripe/invoices/${invoiceId}`);
        const separator = url.includes('?') ? '&' : '?';
        const res = await fetch(`${url}${separator}accountId=${accountId}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || `Failed to delete payment ${invoiceId}`);
        }
      }

      // Clear selection after successful deletion
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        deleteModal.invoiceIds.forEach(id => newSet.delete(id));
        return newSet;
      });

      setDeleteModal({ isOpen: false, invoiceIds: [], isBulk: false });
      onRefresh();
    } catch (err) {
      console.error('Failed to delete invoice(s):', err);
      setError(err instanceof Error ? err.message : 'Failed to delete payment(s)');
    } finally {
      setDeleting(false);
    }
  };

  // Open delete confirmation for single invoice
  const confirmDeleteSingle = (invoiceId: string) => {
    setDeleteModal({ isOpen: true, invoiceIds: [invoiceId], isBulk: false });
  };

  // Open delete confirmation for selected invoices
  const confirmDeleteBulk = () => {
    if (selectedIds.size === 0) return;
    setDeleteModal({ isOpen: true, invoiceIds: Array.from(selectedIds), isBulk: true });
  };

  // Bulk change amount
  const handleBulkChangeAmount = async () => {
    const newAmount = Math.round(parseFloat(bulkEditValue) * 100);
    if (isNaN(newAmount) || newAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setBulkSaving(true);
    setError(null);

    try {
      for (const invoiceId of Array.from(selectedIds)) {
        const invoice = draftInvoices.find(inv => inv.id === invoiceId);
        if (!invoice) continue;

        const res = await fetch(withToken('/api/stripe/invoices/adjust'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId,
            newAmount,
            accountId,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || `Failed to update amount for payment ${invoiceId}`);
        }
      }

      setBulkAmountModal(false);
      setBulkEditValue('');
      onRefresh();
    } catch (err) {
      console.error('Failed to bulk change amount:', err);
      setError(err instanceof Error ? err.message : 'Failed to change amount');
    } finally {
      setBulkSaving(false);
    }
  };

  // Bulk change date - first invoice gets selected date, subsequent invoices get +1 month each
  const handleBulkChangeDate = async () => {
    const newDate = new Date(bulkEditValue + 'T00:00:00');
    if (isNaN(newDate.getTime())) {
      setError('Please enter a valid date');
      return;
    }

    // Sort selected invoices by their current date to maintain order
    const sortedInvoiceIds = Array.from(selectedIds).sort((a, b) => {
      const invA = draftInvoices.find(inv => inv.id === a);
      const invB = draftInvoices.find(inv => inv.id === b);
      const dateA = invA ? (getDisplayedDate(invA) || invA.created || 0) : 0;
      const dateB = invB ? (getDisplayedDate(invB) || invB.created || 0) : 0;
      return dateA - dateB;
    });

    setBulkSaving(true);
    setError(null);

    try {
      for (let i = 0; i < sortedInvoiceIds.length; i++) {
        const invoiceId = sortedInvoiceIds[i];

        // Calculate date: first invoice gets selected date, others get +1 month each
        const invoiceDate = new Date(newDate);
        invoiceDate.setMonth(invoiceDate.getMonth() + i);

        const timestamp = Math.floor(invoiceDate.getTime() / 1000);

        const res = await fetch(withToken('/api/stripe/invoices/schedule'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId,
            scheduledDate: timestamp,
            accountId,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || `Failed to update date for payment ${invoiceId}`);
        }
      }

      setBulkDateModal(false);
      setBulkEditValue('');
      onRefresh();
    } catch (err) {
      console.error('Failed to bulk change date:', err);
      setError(err instanceof Error ? err.message : 'Failed to change date');
    } finally {
      setBulkSaving(false);
    }
  };

  // Helper to calculate the last date in bulk date change sequence
  const getLastBulkDate = (): string => {
    if (!bulkEditValue || selectedIds.size === 0) return '';
    const startDate = new Date(bulkEditValue + 'T00:00:00');
    if (isNaN(startDate.getTime())) return '';
    const lastDate = new Date(startDate);
    lastDate.setMonth(lastDate.getMonth() + selectedIds.size - 1);
    return formatDate(Math.floor(lastDate.getTime() / 1000));
  };

  // Bulk change payment method
  const handleBulkChangeCard = async (paymentMethodId: string) => {
    setBulkSaving(true);
    setError(null);

    try {
      for (const invoiceId of Array.from(selectedIds)) {
        const res = await fetch(withToken('/api/stripe/invoices/payment-method'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId,
            paymentMethodId,
            accountId,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || `Failed to update payment method for payment ${invoiceId}`);
        }
      }

      setBulkCardModal(false);
      onRefresh();
    } catch (err) {
      console.error('Failed to bulk change card:', err);
      setError(err instanceof Error ? err.message : 'Failed to change payment method');
    } finally {
      setBulkSaving(false);
    }
  };

  // Open pause confirmation modal
  const confirmPause = (invoice: InvoiceData) => {
    setPauseModal({ isOpen: true, invoiceId: invoice.id, invoice });
    setPauseReason('');
  };

  // Pause/Resume single invoice
  const handlePauseResume = async (invoiceId: string, pause: boolean) => {
    setPausingId(invoiceId);
    setError(null);

    try {
      const res = await fetch(withToken(`/api/stripe/invoices/${invoiceId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pause',
          pause,
          accountId,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || `Failed to ${pause ? 'pause' : 'resume'} payment`);
      }
      // Close modal if open
      setPauseModal({ isOpen: false, invoiceId: null, invoice: null });
      setPauseReason('');
      onRefresh();
    } catch (err) {
      console.error(`Failed to ${pause ? 'pause' : 'resume'} invoice:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${pause ? 'pause' : 'resume'} payment`);
    } finally {
      setPausingId(null);
    }
  };

  // Bulk pause/resume
  const handleBulkPauseResume = async (pause: boolean) => {
    setBulkSaving(true);
    setError(null);

    try {
      for (const invoiceId of Array.from(selectedIds)) {
        const res = await fetch(withToken(`/api/stripe/invoices/${invoiceId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'pause',
            pause,
            accountId,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || `Failed to ${pause ? 'pause' : 'resume'} payment ${invoiceId}`);
        }
      }

      setSelectedIds(new Set());
      onRefresh();
    } catch (err) {
      console.error(`Failed to bulk ${pause ? 'pause' : 'resume'}:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${pause ? 'pause' : 'resume'} payments`);
    } finally {
      setBulkSaving(false);
    }
  };

  // Check if any operation is in progress
  const isUpdating = saving !== null || bulkSaving || pausingId !== null || deleting;

  // Notify parent of loading state changes
  useEffect(() => {
    onUpdatingChange?.(isUpdating);
  }, [isUpdating, onUpdatingChange]);

  if (allDraftInvoices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-400" />
            Scheduled Payments
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            No scheduled payments
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-sm text-gray-500">
            {draftInvoices.length} payment{draftInvoices.length !== 1 ? 's' : ''}
          </span>
        }
      >
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-600" />
          Scheduled Payments
        </div>
      </CardHeader>

      <CardContent noPadding>
        {error && (
          <div className="mx-4 mt-3 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Bulk Actions Toolbar */}
        {selectedIds.size > 0 && (
          <div className="mx-2 sm:mx-4 mt-2 sm:mt-3 p-2 sm:p-3 bg-indigo-50 rounded-lg flex flex-wrap items-center gap-1.5 sm:gap-3">
            <button
              onClick={toggleSelectAll}
              className="p-0.5 sm:p-1 hover:bg-indigo-100 rounded transition-colors"
              title={isAllSelected ? 'Unselect all' : 'Select all'}
            >
              {isAllSelected ? (
                <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" />
              ) : (
                <MinusSquare className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-600" />
              )}
            </button>
            <span className="text-xs sm:text-sm font-medium text-indigo-700">
              {selectedIds.size} selected
            </span>
            <div className="flex flex-wrap items-center gap-1 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkEditValue('');
                  setBulkAmountModal(true);
                }}
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5"
              >
                <span className="hidden sm:inline">Change </span>Amount
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkEditValue(new Date().toISOString().split('T')[0]);
                  setBulkDateModal(true);
                }}
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5"
              >
                <span className="hidden sm:inline">Change </span>Date
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkCardModal(true)}
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5"
              >
                <span className="hidden sm:inline">Change </span>Card
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkPauseResume(true)}
                disabled={bulkSaving}
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5"
              >
                {bulkSaving ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" /> : <Pause className="w-3 h-3 sm:w-4 sm:h-4" />}
                <span className="hidden sm:inline">Pause</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkPauseResume(false)}
                disabled={bulkSaving}
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 text-green-600 hover:text-green-700"
              >
                {bulkSaving ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" /> : <Play className="w-3 h-3 sm:w-4 sm:h-4" />}
                <span className="hidden sm:inline">Resume</span>
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={confirmDeleteBulk}
                className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5"
              >
                <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </div>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs sm:text-sm text-gray-500 hover:text-gray-700"
            >
              <span className="hidden sm:inline">Clear selection</span>
              <X className="w-4 h-4 sm:hidden" />
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
          <TableHeader>
            <TableRow hoverable={false}>
              {/* Checkbox column - hide select all when items are selected (toolbar shows it) */}
              <th className="p-0">
                {draftInvoices.length > 0 && selectedIds.size === 0 && (
                  <button
                    onClick={toggleSelectAll}
                    className="w-4 h-4 flex items-center justify-center hover:bg-gray-100 rounded transition-colors"
                    title="Select all"
                  >
                    <Square className="w-3 h-3 text-gray-400" />
                  </button>
                )}
              </th>
              <th className="p-0"></th>
              <TableHead compact>Amount</TableHead>
              <TableHead compact>Date</TableHead>
              <TableHead compact><span className="hidden sm:inline">Payment </span>Card</TableHead>
              <TableHead align="right" compact>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draftInvoices.map((invoice) => {
              const displayedPm = getDisplayedPaymentMethod(invoice);
              const invoiceHasChanges = hasChanges(invoice);
              const isSaving = saving === invoice.id;
              const displayedAmount = getDisplayedAmount(invoice);
              const displayedDate = getDisplayedDate(invoice);

              const amountChanged = pendingChanges[invoice.id]?.amount !== undefined &&
                pendingChanges[invoice.id]?.amount !== invoice.amount_due;
              const originalDate = getOriginalDate(invoice);
              const dateChanged = pendingChanges[invoice.id]?.date !== undefined &&
                pendingChanges[invoice.id]?.date !== originalDate;
              const pmChanged = pendingChanges[invoice.id]?.paymentMethodId !== undefined &&
                pendingChanges[invoice.id]?.paymentMethodId !== invoice.default_payment_method;

              // Check if there are non-note changes (for showing row save button)
              const hasNonNoteChanges = amountChanged || dateChanged || pmChanged;

              const isSelected = selectedIds.has(invoice.id);

              // Determine row background: paused = red, selected = indigo, changes = amber
              const rowClassName = invoice.isPaused
                ? `bg-red-100/70 ${isSelected ? '!bg-red-100' : ''}`
                : `${invoiceHasChanges ? 'bg-amber-50/50' : ''} ${isSelected ? 'bg-indigo-50/50' : ''}`;

              const isExpanded = expandedId === invoice.id;

              return (
                <>
                <TableRow key={invoice.id} className={rowClassName}>
                  {/* Checkbox Cell */}
                  <td className="p-0">
                    <button
                      onClick={() => toggleSelect(invoice.id)}
                      className="w-4 h-4 flex items-center justify-center hover:bg-gray-100 rounded transition-colors"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-3 h-3 text-indigo-600" />
                      ) : (
                        <Square className="w-3 h-3 text-gray-400" />
                      )}
                    </button>
                  </td>
                  <td className="p-0">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : invoice.id)}
                      className="w-4 h-4 flex items-center justify-center hover:bg-gray-100 rounded transition-colors"
                      title={isExpanded ? 'Hide details' : 'Show details'}
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-3 h-3 text-gray-500" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-gray-400" />
                      )}
                    </button>
                  </td>

                  {/* Amount Cell */}
                  <TableCell>
                    {editingAmount === invoice.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500 text-xs sm:text-sm">$</span>
                        <input
                          ref={amountInputRef}
                          type="number"
                          step="0.01"
                          min="0.01"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, invoice, 'amount')}
                          onBlur={() => finishEditAmount(invoice)}
                          className="w-16 sm:w-20 px-1.5 sm:px-2 py-0.5 sm:py-1 text-xs sm:text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          disabled={isSaving}
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditAmount(invoice)}
                        className={`font-semibold text-xs sm:text-sm px-1.5 sm:px-2 py-0.5 sm:py-1 rounded transition-colors ${amountChanged
                          ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                          : 'text-gray-900 hover:text-indigo-600 hover:bg-indigo-50'
                          }`}
                      >
                        {formatCurrency(displayedAmount, invoice.currency)}
                      </button>
                    )}
                  </TableCell>

                  {/* Date Cell */}
                  <TableCell>
                    {editingDate === invoice.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          ref={dateInputRef}
                          type="date"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, invoice, 'date')}
                          onBlur={() => finishEditDate(invoice)}
                          className="px-1.5 sm:px-2 py-0.5 sm:py-1 text-xs sm:text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          disabled={isSaving}
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditDate(invoice)}
                        className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded transition-colors ${dateChanged
                          ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                          : 'text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
                          }`}
                      >
                        <Calendar className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${dateChanged ? 'text-amber-500' : 'text-gray-400'}`} />
                        <span className="text-xs sm:text-sm">
                          {displayedDate
                            ? formatDate(displayedDate)
                            : 'Not set'}
                        </span>
                      </button>
                    )}
                  </TableCell>

                  {/* Payment Method Cell - Dropdown */}
                  <TableCell>
                    {editingCard === invoice.id ? (
                      <div className="relative">
                        <div className="absolute z-10 mt-1 w-48 sm:w-64 bg-white border border-gray-200 rounded-lg shadow-lg">
                          <div className="p-1.5 sm:p-2 border-b border-gray-100 flex items-center justify-between">
                            <span className="text-[10px] sm:text-xs font-medium text-gray-500">Select Payment Method</span>
                            <button
                              onClick={() => setEditingCard(null)}
                              className="p-0.5 sm:p-1 hover:bg-gray-100 rounded"
                            >
                              <X className="w-3 h-3 text-gray-400" />
                            </button>
                          </div>
                          <div className="max-h-48 overflow-y-auto">
                            {paymentMethods.map((method) => {
                              const isSelected = pendingChanges[invoice.id]?.paymentMethodId === method.id ||
                                (!pendingChanges[invoice.id]?.paymentMethodId && method.id === invoice.default_payment_method);
                              return (
                                <button
                                  key={method.id}
                                  onClick={() => handlePaymentMethodChange(invoice.id, method.id)}
                                  className={`w-full flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-left hover:bg-gray-50 transition-colors ${isSelected ? 'bg-indigo-50' : ''
                                    }`}
                                  disabled={isSaving}
                                >
                                  <div className="w-6 h-4 sm:w-8 sm:h-5 rounded bg-gray-100 flex items-center justify-center">
                                    <CreditCard className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-500" />
                                  </div>
                                  <span className="text-xs sm:text-sm flex-1">
                                    <span className="capitalize">{method.card?.brand}</span>
                                    <span className="hidden sm:inline">{' •••• '}</span>
                                    <span className="sm:hidden"> ••</span>
                                    {method.card?.last4}
                                  </span>
                                  {method.isDefault && (
                                    <span className="hidden sm:inline text-[10px] bg-gray-100 text-gray-500 px-1 rounded">
                                      Default
                                    </span>
                                  )}
                                  {isSelected && (
                                    <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" />
                                  )}
                                </button>
                              );
                            })}
                            {/* Add new card option */}
                            {onAddCard && (
                              <button
                                onClick={() => {
                                  setEditingCard(null);
                                  onAddCard();
                                }}
                                className="w-full flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 text-left hover:bg-indigo-50 transition-colors border-t border-gray-100"
                              >
                                <div className="w-6 h-4 sm:w-8 sm:h-5 rounded bg-indigo-100 flex items-center justify-center">
                                  <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-indigo-600" />
                                </div>
                                <span className="text-xs sm:text-sm text-indigo-600 font-medium">
                                  Add new card
                                </span>
                              </button>
                            )}
                          </div>
                        </div>
                        {/* Current value shown while dropdown is open */}
                        <div className="flex items-center gap-1.5 sm:gap-2 text-gray-400">
                          {displayedPm ? (
                            <>
                              <div className="w-6 h-4 sm:w-8 sm:h-5 rounded bg-gray-100 flex items-center justify-center">
                                <CreditCard className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400" />
                              </div>
                              <span className="text-xs sm:text-sm">
                                <span className="capitalize">{displayedPm.card?.brand}</span>
                                <span className="hidden sm:inline">{' •••• '}</span>
                                <span className="sm:hidden"> ••</span>
                                {displayedPm.card?.last4}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs sm:text-sm">Select...</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingCard(invoice.id)}
                        className={`group flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded transition-colors ${pmChanged
                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          : 'text-gray-600 hover:text-indigo-600 hover:bg-indigo-50'
                          }`}
                      >
                        {displayedPm ? (
                          <>
                            <div className={`w-6 h-4 sm:w-8 sm:h-5 rounded flex items-center justify-center ${pmChanged ? 'bg-amber-200' : 'bg-gray-100 group-hover:bg-indigo-100'
                              }`}>
                              <CreditCard className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${pmChanged ? 'text-amber-600' : 'text-gray-500 group-hover:text-indigo-500'
                                }`} />
                            </div>
                            <span className="text-xs sm:text-sm">
                              <span className="capitalize hidden sm:inline">{displayedPm.card?.brand}</span>
                              <span className="hidden sm:inline">{' •••• '}</span>
                              <span className="sm:hidden">••</span>
                              {displayedPm.card?.last4}
                            </span>
                            {displayedPm.isDefault && !pmChanged && (
                              <span className="hidden sm:inline text-[10px] bg-gray-100 text-gray-500 px-1 rounded group-hover:bg-indigo-100 group-hover:text-indigo-600">
                                Default
                              </span>
                            )}
                            <ChevronDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${pmChanged ? 'text-amber-500' : 'text-gray-400 group-hover:text-indigo-500'}`} />
                          </>
                        ) : (
                          <>
                            <div className="w-6 h-4 sm:w-8 sm:h-5 rounded bg-amber-50 flex items-center justify-center group-hover:bg-indigo-100">
                              <CreditCard className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-500 group-hover:text-indigo-500" />
                            </div>
                            <span className="text-xs sm:text-sm text-amber-600 group-hover:text-indigo-600">
                              <span className="hidden sm:inline">No card set</span>
                              <span className="sm:hidden">None</span>
                            </span>
                            <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400 group-hover:text-indigo-500" />
                          </>
                        )}
                      </button>
                    )}
                  </TableCell>

                  {/* Save/Cancel/Pause/Delete Actions */}
                  <TableCell>
                    <div className="flex items-center gap-0.5 sm:gap-1 justify-end">
                      {hasNonNoteChanges ? (
                        <>
                          <button
                            onClick={() => saveChanges(invoice)}
                            disabled={isSaving}
                            className="flex items-center justify-center gap-0.5 sm:gap-1 p-1.5 sm:px-2 sm:py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm rounded transition-colors disabled:opacity-50"
                          >
                            {isSaving ? (
                              <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" />
                            ) : (
                              <Save className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            )}
                            <span className="hidden sm:inline">Save</span>
                          </button>
                          <button
                            onClick={() => cancelChanges(invoice.id)}
                            disabled={isSaving}
                            className="flex items-center justify-center p-1.5 sm:p-1 hover:bg-gray-100 text-gray-500 rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center gap-1">
                          {invoice.isPaused ? (
                            <Tooltip content="Resume payment">
                              <button
                                onClick={() => handlePauseResume(invoice.id, false)}
                                disabled={pausingId === invoice.id}
                                className="inline-flex items-center justify-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-md transition-colors disabled:opacity-50"
                              >
                                {pausingId === invoice.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Play className="w-3.5 h-3.5" />
                                )}
                                <span className="hidden sm:inline">Resume</span>
                              </button>
                            </Tooltip>
                          ) : (
                            <Tooltip content="Pause payment">
                              <button
                                onClick={() => confirmPause(invoice)}
                                disabled={pausingId === invoice.id}
                                className="inline-flex items-center justify-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
                              >
                                {pausingId === invoice.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Pause className="w-3.5 h-3.5" />
                                )}
                                <span className="hidden sm:inline">Pause</span>
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip content="Delete payment">
                            <button
                              onClick={() => confirmDeleteSingle(invoice.id)}
                              className="inline-flex items-center justify-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Delete</span>
                            </button>
                          </Tooltip>
                          {/* Add Note button - only show if no note exists */}
                          {!getDisplayedNote(invoice) && editingNote !== invoice.id && (
                            <Tooltip content="Add note">
                              <button
                                onClick={() => startEditNote(invoice)}
                                className="inline-flex items-center justify-center p-1.5 text-xs font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                              >
                                <StickyNote className="w-3.5 h-3.5" />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {/* Note Alert Row - only show if note exists or editing */}
                {(() => {
                  const displayedNote = getDisplayedNote(invoice);
                  const originalNote = invoice.note || '';
                  const noteChanged = pendingChanges[invoice.id]?.note !== undefined &&
                    pendingChanges[invoice.id]?.note !== originalNote;
                  const showNote = displayedNote || editingNote === invoice.id;

                  if (!showNote) return null;

                  return (
                    <tr key={`${invoice.id}-note`}>
                      <td colSpan={100} className="px-2 sm:px-3 py-1 border-b border-gray-100">
                        <div className={`flex items-center gap-2 px-2 py-1 rounded ${
                          noteChanged ? 'bg-amber-50 border border-amber-200' : 'bg-gray-100 border border-gray-200'
                        }`}>
                          <StickyNote className={`w-3 h-3 flex-shrink-0 ${noteChanged ? 'text-amber-500' : 'text-gray-400'}`} />
                          {editingNote === invoice.id ? (
                            <input
                              type="text"
                              value={noteEditValue}
                              onChange={(e) => handleNoteInputChange(invoice, e.target.value)}
                              onBlur={() => closeNoteEditor()}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  closeNoteEditor();
                                }
                              }}
                              autoFocus
                              placeholder="Add a note..."
                              className="flex-1 text-xs text-gray-700 bg-white border border-gray-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          ) : (
                            <button
                              onClick={() => startEditNote(invoice)}
                              className={`flex-1 text-left text-xs hover:underline ${
                                noteChanged ? 'text-amber-700' : 'text-gray-600'
                              }`}
                            >
                              {displayedNote}
                            </button>
                          )}
                          {noteChanged && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                onClick={() => saveNoteOnly(invoice)}
                                disabled={saving === invoice.id}
                                className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] rounded transition-colors disabled:opacity-50"
                              >
                                {saving === invoice.id ? (
                                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                ) : (
                                  <Save className="w-2.5 h-2.5" />
                                )}
                                Save
                              </button>
                              <button
                                onClick={() => cancelNoteOnly(invoice.id)}
                                disabled={saving === invoice.id}
                                className="p-0.5 hover:bg-gray-200 text-gray-500 rounded transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })()}
                {/* Expanded Details */}
                {isExpanded && (
                  <tr key={`${invoice.id}-expanded`}>
                    <td colSpan={100} className="bg-gray-50 px-4 py-3 border-b">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5 text-gray-500 text-xs">
                            <Hash className="w-3 h-3" />
                            <span className="font-mono">{invoice.id}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => copyToClipboard(invoice.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded transition-colors"
                            title={`Copy Payment ID: ${invoice.id}`}
                          >
                            {copiedId === invoice.id ? (
                              <Check className="w-3.5 h-3.5 text-green-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            <span className="hidden sm:inline">Copy ID</span>
                          </button>
                          <a
                            href={`https://dashboard.stripe.com/invoices/${invoice.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                            title="Open in Stripe"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Stripe</span>
                          </a>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </>
              );
            })}
          </TableBody>
        </table>
        </div>
      </CardContent>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, invoiceIds: [], isBulk: false })}
        title={deleteModal.isBulk ? 'Delete Payments' : 'Delete Payment'}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            {deleteModal.isBulk
              ? `Are you sure you want to delete ${deleteModal.invoiceIds.length} payment${deleteModal.invoiceIds.length !== 1 ? 's' : ''}? This action cannot be undone.`
              : 'Are you sure you want to delete this payment? This action cannot be undone.'}
          </p>
          {deleteModal.isBulk && (
            <div className="bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto">
              <p className="text-xs font-medium text-gray-500 mb-2">Payments to delete:</p>
              {deleteModal.invoiceIds.map(id => {
                const invoice = allDraftInvoices.find(inv => inv.id === id);
                return (
                  <div key={id} className="text-sm text-gray-700 flex justify-between py-1">
                    <span className="font-mono text-xs">{id.slice(0, 20)}...</span>
                    {invoice && <span className="font-medium">{formatCurrency(invoice.amount_due, invoice.currency)}</span>}
                  </div>
                );
              })}
            </div>
          )}
          <ModalFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteModal({ isOpen: false, invoiceIds: [], isBulk: false })}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete
                </>
              )}
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      {/* Bulk Change Amount Modal */}
      <Modal
        isOpen={bulkAmountModal}
        onClose={() => setBulkAmountModal(false)}
        title="Change Amount"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Set a new amount for {selectedIds.size} selected payment{selectedIds.size !== 1 ? 's' : ''}.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Amount</label>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={bulkEditValue}
                onChange={(e) => setBulkEditValue(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="0.00"
              />
            </div>
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => setBulkAmountModal(false)} disabled={bulkSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleBulkChangeAmount} disabled={bulkSaving || !bulkEditValue}>
              {bulkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Apply to {selectedIds.size} payment{selectedIds.size !== 1 ? 's' : ''}
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      {/* Bulk Change Date Modal */}
      <Modal
        isOpen={bulkDateModal}
        onClose={() => setBulkDateModal(false)}
        title="Change Payment Dates"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Set the start date for {selectedIds.size} payment{selectedIds.size !== 1 ? 's' : ''}. Each subsequent payment will be scheduled for the same day in the following month.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
            <input
              type="date"
              value={bulkEditValue}
              onChange={(e) => setBulkEditValue(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {bulkEditValue && selectedIds.size > 1 && (
            <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-100">
              <p className="text-sm text-indigo-700">
                <span className="font-medium">Last payment date:</span> {getLastBulkDate()}
              </p>
            </div>
          )}
          <ModalFooter>
            <Button variant="outline" onClick={() => setBulkDateModal(false)} disabled={bulkSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleBulkChangeDate} disabled={bulkSaving || !bulkEditValue}>
              {bulkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Apply to {selectedIds.size} payment{selectedIds.size !== 1 ? 's' : ''}
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      {/* Bulk Change Card Modal */}
      <Modal
        isOpen={bulkCardModal}
        onClose={() => setBulkCardModal(false)}
        title="Change Payment Method"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Select a payment method for {selectedIds.size} selected payment{selectedIds.size !== 1 ? 's' : ''}.
          </p>
          <div className="space-y-2">
            {paymentMethods.map((method) => (
              <button
                key={method.id}
                onClick={() => handleBulkChangeCard(method.id)}
                disabled={bulkSaving}
                className="w-full flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <div className="w-10 h-6 rounded bg-gray-100 flex items-center justify-center">
                  <CreditCard className="w-4 h-4 text-gray-500" />
                </div>
                <span className="flex-1 text-left">
                  <span className="capitalize font-medium">{method.card?.brand}</span>
                  {' •••• '}
                  {method.card?.last4}
                </span>
                {method.isDefault && (
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                    Default
                  </span>
                )}
                {bulkSaving && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
              </button>
            ))}
            {/* Add new card option */}
            {onAddCard && (
              <button
                onClick={() => {
                  setBulkCardModal(false);
                  onAddCard();
                }}
                className="w-full flex items-center gap-3 p-3 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
              >
                <div className="w-10 h-6 rounded bg-indigo-100 flex items-center justify-center">
                  <Plus className="w-4 h-4 text-indigo-600" />
                </div>
                <span className="flex-1 text-left text-indigo-600 font-medium">
                  Add new card
                </span>
              </button>
            )}
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => setBulkCardModal(false)} disabled={bulkSaving}>
              Cancel
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      {/* Pause Confirmation Modal */}
      <Modal
        isOpen={pauseModal.isOpen}
        onClose={() => {
          setPauseModal({ isOpen: false, invoiceId: null, invoice: null });
          setPauseReason('');
        }}
        title={pauseModal.invoice ? `Pause Payment: ${formatDate(getDisplayedDate(pauseModal.invoice) || pauseModal.invoice.created)} - ${formatCurrency(pauseModal.invoice.amount_due, pauseModal.invoice.currency)}` : 'Pause Payment'}
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
            <div className="flex items-start gap-3">
              <Pause className="w-5 h-5 text-amber-600 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800">
                  Are you sure you want to pause this payment?
                </p>
                <p className="text-sm text-amber-600 mt-1">
                  The payment will not be automatically finalized or charged until resumed.
                </p>
              </div>
            </div>
          </div>

          {pauseModal.invoice && (
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-500">Payment Date</span>
                <span className="text-sm text-gray-700">{formatDate(getDisplayedDate(pauseModal.invoice) || pauseModal.invoice.created)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Amount</span>
                <span className="font-semibold text-gray-900">
                  {formatCurrency(pauseModal.invoice.amount_due, pauseModal.invoice.currency)}
                </span>
              </div>
            </div>
          )}

          {/* Reason (optional) */}
          <Textarea
            label="Reason (optional)"
            placeholder="Why are you pausing this payment..."
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            rows={3}
          />

          <ModalFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPauseModal({ isOpen: false, invoiceId: null, invoice: null });
                setPauseReason('');
              }}
              disabled={pausingId !== null}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => pauseModal.invoiceId && handlePauseResume(pauseModal.invoiceId, true)}
              disabled={pausingId !== null}
            >
              {pausingId === pauseModal.invoiceId ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Pausing...
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4" />
                  Pause Payment
                </>
              )}
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </Card>
  );
}
