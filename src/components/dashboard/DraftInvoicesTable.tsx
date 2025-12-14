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
} from '@/components/ui';
import {
  Clock,
  Copy,
  Check,
  CreditCard,
  ChevronDown,
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
} from 'lucide-react';

interface FutureInvoicesTableProps {
  invoices: InvoiceData[];
  paymentMethods?: PaymentMethodData[];
  token?: string;
  accountId?: string;
  onRefresh: () => void;
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
}

export function FutureInvoicesTable({
  invoices,
  paymentMethods = [],
  token,
  accountId,
  onRefresh,
}: FutureInvoicesTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Track pending changes per invoice
  const [pendingChanges, setPendingChanges] = useState<Record<string, PendingChanges>>({});

  // UI state for editing (which field is currently being edited)
  const [editingAmount, setEditingAmount] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
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
  const [showPaused, setShowPaused] = useState(true);

  // Paused invoices selection state
  const [selectedPausedIds, setSelectedPausedIds] = useState<Set<string>>(new Set());

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

  // Helper to get Payment date for sorting (prioritize metadata.scheduledFinalizeAt)
  const getFinalizeDate = (inv: InvoiceData): number => {
    if (inv.metadata?.scheduledFinalizeAt) return parseInt(inv.metadata.scheduledFinalizeAt, 10);
    if (inv.automatically_finalizes_at) return inv.automatically_finalizes_at;
    return inv.due_date || inv.created;
  };

  // Filter to only draft invoices, split into active and paused
  const allDraftInvoices = invoices.filter(inv => inv.status === 'draft');

  const activeInvoices = allDraftInvoices
    .filter(inv => !inv.isPaused)
    .sort((a, b) => getFinalizeDate(a) - getFinalizeDate(b));

  const pausedInvoices = allDraftInvoices
    .filter(inv => inv.isPaused)
    .sort((a, b) => getFinalizeDate(a) - getFinalizeDate(b));

  // For backward compatibility, draftInvoices refers to active ones
  const draftInvoices = activeInvoices;

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
  const getOriginalDate = (invoice: InvoiceData): number | null => {
    if (invoice.metadata?.scheduledFinalizeAt) return parseInt(invoice.metadata.scheduledFinalizeAt, 10);
    if (invoice.automatically_finalizes_at) return invoice.automatically_finalizes_at;
    return invoice.due_date || null;
  };

  // Check if invoice has pending changes
  const hasChanges = (invoice: InvoiceData): boolean => {
    const changes = pendingChanges[invoice.id];
    if (!changes) return false;

    const amountChanged = changes.amount !== undefined && changes.amount !== invoice.amount_due;
    const originalDate = getOriginalDate(invoice);
    const dateChanged = changes.date !== undefined && changes.date !== originalDate;
    const pmChanged = changes.paymentMethodId !== undefined && changes.paymentMethodId !== invoice.default_payment_method;

    return amountChanged || dateChanged || pmChanged;
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
  const finishEditDate = (invoice: InvoiceData) => {
    const newDate = new Date(editValue + 'T00:00:00');
    if (!isNaN(newDate.getTime())) {
      const timestamp = Math.floor(newDate.getTime() / 1000);
      const originalDate = getOriginalDate(invoice);
      // Compare dates by day only (ignore time differences)
      const originalDateOnly = originalDate ? Math.floor(new Date(originalDate * 1000).setHours(0, 0, 0, 0) / 1000) : null;
      const newDateOnly = Math.floor(new Date(timestamp * 1000).setHours(0, 0, 0, 0) / 1000);

      console.log('Date comparison:', { editValue, timestamp, originalDate, originalDateOnly, newDateOnly, changed: newDateOnly !== originalDateOnly });

      if (newDateOnly !== originalDateOnly) {
        setPendingChanges(prev => ({
          ...prev,
          [invoice.id]: { ...prev[invoice.id], date: timestamp },
        }));
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

  // Get displayed amount (pending or original)
  const getDisplayedAmount = (invoice: InvoiceData): number => {
    return pendingChanges[invoice.id]?.amount ?? invoice.amount_due;
  };

  // Get displayed date (pending or original)
  // Prioritize metadata.scheduledFinalizeAt since that's where we store user's custom date
  const getDisplayedDate = (invoice: InvoiceData): number | null => {
    const changes = pendingChanges[invoice.id];
    if (changes?.date !== undefined) return changes.date;
    // Check multiple sources - prioritize our custom metadata field
    if (invoice.metadata?.scheduledFinalizeAt) return parseInt(invoice.metadata.scheduledFinalizeAt, 10);
    if (invoice.automatically_finalizes_at) return invoice.automatically_finalizes_at;
    return invoice.due_date || null;
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

  // Paused invoices selection helpers
  const toggleSelectPaused = (invoiceId: string) => {
    setSelectedPausedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(invoiceId)) {
        newSet.delete(invoiceId);
      } else {
        newSet.add(invoiceId);
      }
      return newSet;
    });
  };

  const toggleSelectAllPaused = () => {
    if (selectedPausedIds.size === pausedInvoices.length) {
      setSelectedPausedIds(new Set());
    } else {
      setSelectedPausedIds(new Set(pausedInvoices.map(inv => inv.id)));
    }
  };

  const isAllPausedSelected = pausedInvoices.length > 0 && selectedPausedIds.size === pausedInvoices.length;
  const isSomePausedSelected = selectedPausedIds.size > 0 && selectedPausedIds.size < pausedInvoices.length;

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
          throw new Error(data.error || `Failed to delete invoice ${invoiceId}`);
        }
      }

      // Clear selection after successful deletion (from both active and paused)
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        deleteModal.invoiceIds.forEach(id => newSet.delete(id));
        return newSet;
      });
      setSelectedPausedIds(prev => {
        const newSet = new Set(prev);
        deleteModal.invoiceIds.forEach(id => newSet.delete(id));
        return newSet;
      });

      setDeleteModal({ isOpen: false, invoiceIds: [], isBulk: false });
      onRefresh();
    } catch (err) {
      console.error('Failed to delete invoice(s):', err);
      setError(err instanceof Error ? err.message : 'Failed to delete invoice(s)');
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

  // Open delete confirmation for selected paused invoices
  const confirmDeleteBulkPaused = () => {
    if (selectedPausedIds.size === 0) return;
    setDeleteModal({ isOpen: true, invoiceIds: Array.from(selectedPausedIds), isBulk: true });
  };

  // Bulk resume paused invoices
  const handleBulkResume = async () => {
    setBulkSaving(true);
    setError(null);

    try {
      for (const invoiceId of Array.from(selectedPausedIds)) {
        const res = await fetch(withToken(`/api/stripe/invoices/${invoiceId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'pause',
            pause: false,
            accountId,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || `Failed to resume invoice ${invoiceId}`);
        }
      }

      setSelectedPausedIds(new Set());
      onRefresh();
    } catch (err) {
      console.error('Failed to bulk resume:', err);
      setError(err instanceof Error ? err.message : 'Failed to resume invoices');
    } finally {
      setBulkSaving(false);
    }
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
          throw new Error(data.error || `Failed to update amount for invoice ${invoiceId}`);
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

  // Bulk change date
  const handleBulkChangeDate = async () => {
    const newDate = new Date(bulkEditValue + 'T00:00:00');
    if (isNaN(newDate.getTime())) {
      setError('Please enter a valid date');
      return;
    }
    const timestamp = Math.floor(newDate.getTime() / 1000);

    setBulkSaving(true);
    setError(null);

    try {
      for (const invoiceId of Array.from(selectedIds)) {
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
          throw new Error(data.error || `Failed to update date for invoice ${invoiceId}`);
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
          throw new Error(data.error || `Failed to update payment method for invoice ${invoiceId}`);
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
        throw new Error(data.error || `Failed to ${pause ? 'pause' : 'resume'} invoice`);
      }
      onRefresh();
    } catch (err) {
      console.error(`Failed to ${pause ? 'pause' : 'resume'} invoice:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${pause ? 'pause' : 'resume'} invoice`);
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
          throw new Error(data.error || `Failed to ${pause ? 'pause' : 'resume'} invoice ${invoiceId}`);
        }
      }

      setSelectedIds(new Set());
      onRefresh();
    } catch (err) {
      console.error(`Failed to bulk ${pause ? 'pause' : 'resume'}:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${pause ? 'pause' : 'resume'} invoices`);
    } finally {
      setBulkSaving(false);
    }
  };

  if (allDraftInvoices.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader
        action={
          <span className="text-sm text-gray-500">
            {draftInvoices.length} invoice{draftInvoices.length !== 1 ? 's' : ''}
          </span>
        }
      >
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-600" />
          Future Payment
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

        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow hoverable={false}>
              {/* Checkbox column */}
              <TableHead className="w-[40px]">
                <button
                  onClick={toggleSelectAll}
                  className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  {isAllSelected ? (
                    <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" />
                  ) : isSomeSelected ? (
                    <MinusSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" />
                  ) : (
                    <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" />
                  )}
                </button>
              </TableHead>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead className="w-[100px]">Amount</TableHead>
              <TableHead className="w-[100px]"><span className="hidden sm:inline">Finalize </span>Date</TableHead>
              <TableHead className="w-[140px]"><span className="hidden sm:inline">Payment </span>Card</TableHead>
              <TableHead align="right">Actions</TableHead>
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

              const isSelected = selectedIds.has(invoice.id);

              return (
                <TableRow key={invoice.id} className={`${invoiceHasChanges ? 'bg-amber-50/50' : ''} ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                  {/* Checkbox Cell */}
                  <TableCell>
                    <button
                      onClick={() => toggleSelect(invoice.id)}
                      className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors"
                    >
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" />
                      ) : (
                        <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" />
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-0.5 sm:gap-1">
                      <button
                        onClick={() => copyToClipboard(invoice.id)}
                        className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors"
                        title={invoice.id}
                      >
                        {copiedId === invoice.id ? (
                          <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" />
                        )}
                      </button>
                      <a
                        href={`https://dashboard.stripe.com/invoices/${invoice.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors hidden sm:block"
                        title="Open in Stripe"
                      >
                        <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400 hover:text-indigo-600" />
                      </a>
                    </div>
                  </TableCell>

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
                      {invoiceHasChanges ? (
                        <>
                          <button
                            onClick={() => saveChanges(invoice)}
                            disabled={isSaving}
                            className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm rounded transition-colors disabled:opacity-50"
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
                            className="p-0.5 sm:p-1 hover:bg-gray-100 text-gray-500 rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handlePauseResume(invoice.id, true)}
                            disabled={pausingId === invoice.id}
                            className="inline-flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
                            title="Pause invoice"
                          >
                            {pausingId === invoice.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Pause className="w-3.5 h-3.5" />
                            )}
                            <span className="hidden sm:inline">Pause</span>
                          </button>
                          <button
                            onClick={() => confirmDeleteSingle(invoice.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                            title="Delete invoice"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Paused Invoices Section */}
        {pausedInvoices.length > 0 && (
          <div className="border-t border-gray-200">
            <button
              onClick={() => setShowPaused(!showPaused)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Pause className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium text-gray-700">
                  Paused Invoices ({pausedInvoices.length})
                </span>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showPaused ? 'rotate-180' : ''}`} />
            </button>

            {showPaused && (
              <>
                {/* Bulk Actions Toolbar for Paused Invoices */}
                {selectedPausedIds.size > 0 && (
                  <div className="mx-2 sm:mx-4 mt-2 sm:mt-3 p-2 sm:p-3 bg-green-50 rounded-lg flex flex-wrap items-center gap-1.5 sm:gap-3">
                    <span className="text-xs sm:text-sm font-medium text-green-700">
                      {selectedPausedIds.size} selected
                    </span>
                    <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleBulkResume}
                        disabled={bulkSaving}
                        className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5"
                      >
                        {bulkSaving ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" /> : <Play className="w-3 h-3 sm:w-4 sm:h-4" />}
                        <span className="hidden sm:inline">Resume</span>
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={confirmDeleteBulkPaused}
                        className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5"
                      >
                        <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                        <span className="hidden sm:inline">Delete</span>
                      </Button>
                    </div>
                    <button
                      onClick={() => setSelectedPausedIds(new Set())}
                      className="ml-auto text-xs sm:text-sm text-gray-500 hover:text-gray-700"
                    >
                      <span className="hidden sm:inline">Clear selection</span>
                      <X className="w-4 h-4 sm:hidden" />
                    </button>
                  </div>
                )}

                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow hoverable={false}>
                      {/* Checkbox column */}
                      <TableHead className="w-[40px]">
                        <button
                          onClick={toggleSelectAllPaused}
                          className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors"
                        >
                          {isAllPausedSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                          ) : isSomePausedSelected ? (
                            <MinusSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                          ) : (
                            <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                      <TableHead className="w-[100px]">Amount</TableHead>
                      <TableHead className="w-[100px]">Paused Date</TableHead>
                      <TableHead className="w-[140px]"><span className="hidden sm:inline">Payment </span>Card</TableHead>
                      <TableHead align="right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pausedInvoices.map((invoice) => {
                      const pm = getPaymentMethod(invoice);
                      const pausedAt = invoice.metadata?.pausedAt
                        ? new Date(parseInt(invoice.metadata.pausedAt)).toLocaleDateString()
                        : 'Unknown';
                      const isPausing = pausingId === invoice.id;
                      const isPausedSelected = selectedPausedIds.has(invoice.id);

                      return (
                        <TableRow key={invoice.id} className={`bg-amber-50/30 ${isPausedSelected ? 'bg-green-50/50' : ''}`}>
                          {/* Checkbox Cell */}
                          <TableCell>
                            <button
                              onClick={() => toggleSelectPaused(invoice.id)}
                              className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors"
                            >
                              {isPausedSelected ? (
                                <CheckSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                              ) : (
                                <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" />
                              )}
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-0.5 sm:gap-1">
                              <button
                                onClick={() => copyToClipboard(invoice.id)}
                                className="p-0.5 sm:p-1 hover:bg-gray-100 rounded transition-colors"
                                title={invoice.id}
                              >
                                {copiedId === invoice.id ? (
                                  <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-400" />
                                )}
                              </button>
                            </div>
                          </TableCell>

                          <TableCell>
                            <span className="font-semibold text-xs sm:text-sm text-gray-600">
                              {formatCurrency(invoice.amount_due, invoice.currency)}
                            </span>
                          </TableCell>

                          <TableCell>
                            <span className="text-xs sm:text-sm text-gray-500">
                              {pausedAt}
                            </span>
                          </TableCell>

                          <TableCell>
                            {pm ? (
                              <div className="flex items-center gap-1.5 sm:gap-2 text-gray-500">
                                <div className="w-6 h-4 sm:w-8 sm:h-5 rounded bg-gray-100 flex items-center justify-center">
                                  <CreditCard className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gray-400" />
                                </div>
                                <span className="text-xs sm:text-sm">
                                  <span className="capitalize hidden sm:inline">{pm.card?.brand}</span>
                                  <span className="hidden sm:inline">{' •••• '}</span>
                                  <span className="sm:hidden">••</span>
                                  {pm.card?.last4}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs sm:text-sm text-gray-400">No card</span>
                            )}
                          </TableCell>

                          <TableCell>
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => handlePauseResume(invoice.id, false)}
                                disabled={isPausing}
                                className="inline-flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-md transition-colors disabled:opacity-50"
                                title="Resume invoice"
                              >
                                {isPausing ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Play className="w-3.5 h-3.5" />
                                )}
                                <span className="hidden sm:inline">Resume</span>
                              </button>
                              <button
                                onClick={() => confirmDeleteSingle(invoice.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                                title="Delete invoice"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Delete</span>
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            )}
          </div>
        )}
      </CardContent>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, invoiceIds: [], isBulk: false })}
        title={deleteModal.isBulk ? 'Delete Invoices' : 'Delete Invoice'}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            {deleteModal.isBulk
              ? `Are you sure you want to delete ${deleteModal.invoiceIds.length} invoice${deleteModal.invoiceIds.length !== 1 ? 's' : ''}? This action cannot be undone.`
              : 'Are you sure you want to delete this invoice? This action cannot be undone.'}
          </p>
          {deleteModal.isBulk && (
            <div className="bg-gray-50 rounded-lg p-3 max-h-32 overflow-y-auto">
              <p className="text-xs font-medium text-gray-500 mb-2">Invoices to delete:</p>
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
            Set a new amount for {selectedIds.size} selected invoice{selectedIds.size !== 1 ? 's' : ''}.
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
              Apply to {selectedIds.size} invoice{selectedIds.size !== 1 ? 's' : ''}
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      {/* Bulk Change Date Modal */}
      <Modal
        isOpen={bulkDateModal}
        onClose={() => setBulkDateModal(false)}
        title="Change Payment date"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Set a new Payment date for {selectedIds.size} selected invoice{selectedIds.size !== 1 ? 's' : ''}.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Date</label>
            <input
              type="date"
              value={bulkEditValue}
              onChange={(e) => setBulkEditValue(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => setBulkDateModal(false)} disabled={bulkSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleBulkChangeDate} disabled={bulkSaving || !bulkEditValue}>
              {bulkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Apply to {selectedIds.size} invoice{selectedIds.size !== 1 ? 's' : ''}
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
            Select a payment method for {selectedIds.size} selected invoice{selectedIds.size !== 1 ? 's' : ''}.
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
          </div>
          <ModalFooter>
            <Button variant="outline" onClick={() => setBulkCardModal(false)} disabled={bulkSaving}>
              Cancel
            </Button>
          </ModalFooter>
        </div>
      </Modal>
    </Card>
  );
}
