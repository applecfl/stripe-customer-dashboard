'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { InvoiceData, CustomerData, PaymentMethodData, ExtendedCustomerInfo } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { generatePaymentReminderHtml } from '@/lib/emailTemplate';
import { Modal, ModalFooter, Button, Input } from '@/components/ui';
import { Send, AlertCircle, CheckCircle, X, RotateCcw, Bold, Italic, Link, List, Plus } from 'lucide-react';

interface SendReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceData | null;
  customer: CustomerData | null;
  paymentMethods: PaymentMethodData[];
  accountId: string;
  paymentLink: string;
  extendedInfo?: ExtendedCustomerInfo;
}

export function SendReminderModal({
  isOpen,
  onClose,
  invoice,
  customer,
  paymentMethods,
  accountId,
  paymentLink,
  extendedInfo,
}: SendReminderModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [subject, setSubject] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Find the payment method used (from invoice's default or customer's default)
  const paymentMethod = invoice?.default_payment_method
    ? paymentMethods.find(pm => pm.id === invoice.default_payment_method)
    : paymentMethods.find(pm => pm.isDefault) || paymentMethods[0];

  // Get the correct invoice date (same logic as FailedPaymentsTable)
  // Priority: scheduledFinalizeAt → effective_at → due_date → created
  const getInvoiceDate = (inv: InvoiceData): number | null => {
    if (inv.metadata?.scheduledFinalizeAt) return parseInt(inv.metadata.scheduledFinalizeAt, 10);
    if (inv.effective_at) return inv.effective_at;
    if (inv.due_date) return inv.due_date;
    return inv.created;
  };

  // Format the invoice date (short month like "Aug 21, 2025")
  const invoiceTimestamp = invoice ? getInvoiceDate(invoice) : null;
  const invoiceDate = invoiceTimestamp
    ? new Date(invoiceTimestamp * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  // Format amount for display
  const formattedAmount = invoice
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: invoice.currency.toUpperCase(),
      }).format(invoice.amount_due / 100)
    : '';

  // Default subject - includes due date if available
  const defaultSubject = invoiceDate
    ? `Payment Reminder - ${formattedAmount} Due ${invoiceDate}`
    : `Payment Reminder - ${formattedAmount} Due`;

  // Get recipient name from extendedInfo (pre-formatted parentsName, or father/mother names) or fallback to customer name
  const getRecipientName = (): string => {
    // Use pre-formatted parentsName if available (e.g., "Mr. Boris and Mrs. Kristina Akbosh")
    if (extendedInfo?.parentsName) {
      return extendedInfo.parentsName;
    }
    // Fallback to combining individual parent names
    const names: string[] = [];
    if (extendedInfo?.fatherName) {
      names.push(extendedInfo.fatherName);
    }
    if (extendedInfo?.motherName) {
      names.push(extendedInfo.motherName);
    }
    if (names.length > 0) {
      return names.join(' and ');
    }
    return customer?.name || '';
  };

  // Collect initial emails from extendedInfo and customer
  const getInitialEmails = (): string[] => {
    const emailSet = new Set<string>();
    // Add customer email first
    if (customer?.email) {
      emailSet.add(customer.email);
    }
    // Add emails from extendedInfo (father and mother)
    if (extendedInfo?.fatherEmail) {
      emailSet.add(extendedInfo.fatherEmail);
    }
    if (extendedInfo?.motherEmail) {
      emailSet.add(extendedInfo.motherEmail);
    }
    return Array.from(emailSet);
  };

  // Generate the base HTML template
  const recipientName = getRecipientName();
  const baseHtml = useMemo(() => {
    if (!invoice || !customer) return '';
    return generatePaymentReminderHtml({
      customerName: recipientName,
      organizationName: 'LEC',
      logoUrl: 'https://lecfl.com/wp-content/uploads/2024/08/LEC-Logo-Primary-1.png',
      dueDate: invoiceDate,
      cardLast4: paymentMethod?.card?.last4 || null,
      cardBrand: paymentMethod?.card?.brand || null,
      formattedAmount,
      paymentLink,
    });
  }, [invoice, customer, recipientName, invoiceDate, paymentMethod, formattedAmount, paymentLink]);

  // Initialize when modal opens
  useEffect(() => {
    if (isOpen && baseHtml) {
      setSubject(defaultSubject);
      setEmails(getInitialEmails());
      setNewEmail('');
      setHasChanges(false);
    }
  }, [isOpen, baseHtml, defaultSubject, customer, extendedInfo]);

  // Setup editable iframe when baseHtml changes
  useEffect(() => {
    if (isOpen && iframeRef.current && baseHtml) {
      const iframe = iframeRef.current;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(baseHtml);
        doc.close();
        // Make the body editable
        doc.body.contentEditable = 'true';
        doc.body.style.outline = 'none';
        // Listen for changes
        doc.body.addEventListener('input', () => {
          setHasChanges(true);
        });
      }
    }
  }, [isOpen, baseHtml]);

  const handleSubjectChange = (value: string) => {
    setSubject(value);
    setHasChanges(value !== defaultSubject);
  };

  const handleReset = () => {
    setSubject(defaultSubject);
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(baseHtml);
        doc.close();
        doc.body.contentEditable = 'true';
        doc.body.style.outline = 'none';
        doc.body.addEventListener('input', () => {
          setHasChanges(true);
        });
      }
    }
    setHasChanges(false);
  };

  // WYSIWYG commands
  const execCommand = (command: string, value?: string) => {
    const iframe = iframeRef.current;
    if (iframe) {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc) {
        doc.execCommand(command, false, value);
        iframe.contentWindow?.focus();
        setHasChanges(true);
      }
    }
  };

  const handleBold = () => execCommand('bold');
  const handleItalic = () => execCommand('italic');
  const handleLink = () => {
    const url = prompt('Enter URL:');
    if (url) execCommand('createLink', url);
  };
  const handleList = () => execCommand('insertUnorderedList');

  // Email management functions
  const addEmail = () => {
    const email = newEmail.trim().toLowerCase();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !emails.includes(email)) {
      setEmails([...emails, email]);
      setNewEmail('');
    }
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails(emails.filter(e => e !== emailToRemove));
  };

  const handleEmailKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEmail();
    }
  };

  if (!invoice || !customer) return null;

  const getEmailHtml = (): string => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow?.document;
      if (doc) {
        return '<!DOCTYPE html><html>' + doc.documentElement.innerHTML + '</html>';
      }
    }
    return baseHtml;
  };

  const handleSend = async () => {
    if (emails.length === 0) {
      setError('Please add at least one email address');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const customHtml = getEmailHtml();
      const response = await fetch('/api/send-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: recipientName,
          customerEmails: emails,
          amount: invoice.amount_due,
          currency: invoice.currency,
          dueDate: invoiceDate,
          cardLast4: paymentMethod?.card?.last4 || null,
          cardBrand: paymentMethod?.card?.brand || null,
          paymentLink,
          accountId,
          customHtml: hasChanges ? customHtml : undefined,
          customSubject: subject !== defaultSubject ? subject : undefined,
          senderName: extendedInfo?.senderName,
          senderEmail: extendedInfo?.senderEmail,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to send reminder');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reminder');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError('');
    setSuccess(false);
    setSubject('');
    setHasChanges(false);
    onClose();
  };

  // Modal title with due date
  const modalTitle = invoiceDate
    ? `Send Payment Reminder - Due ${invoiceDate}`
    : 'Send Payment Reminder';

  // Success state
  if (success) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title="Reminder Sent" size="sm">
        <div className="text-center py-6">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Email Sent Successfully!</h3>
          <p className="text-gray-600 text-sm">
            A payment reminder has been sent to{' '}
            <span className="font-medium">{emails.length} recipient{emails.length !== 1 ? 's' : ''}</span>
          </p>
        </div>
        <ModalFooter>
          <Button onClick={handleClose}>
            Done
          </Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={modalTitle}
      size="full"
    >
      <div className="flex flex-col h-[calc(100vh-200px)] min-h-[500px]">
        {/* Email Header - From, To, Subject */}
        <div className="border-b border-gray-200 pb-4 mb-4 space-y-3">
          {/* From Field - Read-only sender info */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-500 w-16">From:</label>
            <div className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
              {extendedInfo?.senderName && extendedInfo?.senderEmail ? (
                <span>
                  <span className="font-medium">{extendedInfo.senderName}</span>
                  <span className="text-gray-500 ml-1">&lt;{extendedInfo.senderEmail}&gt;</span>
                </span>
              ) : extendedInfo?.senderEmail ? (
                <span>{extendedInfo.senderEmail}</span>
              ) : (
                <span className="text-gray-400">Default sender (admin@lecfl.com)</span>
              )}
            </div>
          </div>

          {/* To Field - Multiple emails */}
          <div className="flex items-start gap-3">
            <label className="text-sm font-medium text-gray-500 w-16 pt-2">To:</label>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 p-2 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent min-h-[42px]">
                {emails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-full text-sm"
                  >
                    {email}
                    <button
                      type="button"
                      onClick={() => removeEmail(email)}
                      className="hover:bg-indigo-200 rounded-full p-0.5 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <div className="flex items-center gap-1 flex-1 min-w-[200px]">
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={handleEmailKeyDown}
                    className="flex-1 outline-none text-sm py-1 min-w-[150px]"
                    placeholder={emails.length === 0 ? "Add email address..." : "Add another email..."}
                  />
                  <button
                    type="button"
                    onClick={addEmail}
                    disabled={!newEmail.trim()}
                    className="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Add email"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">Press Enter or click + to add an email</p>
            </div>
          </div>

          {/* Subject Field */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-500 w-16">Subject:</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => handleSubjectChange(e.target.value)}
              className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="Email subject..."
            />
          </div>
        </div>

        {/* WYSIWYG Toolbar */}
        <div className="flex items-center gap-1 pb-2 border-b border-gray-200 mb-2">
          <button
            type="button"
            onClick={handleBold}
            className="p-2 hover:bg-gray-100 rounded transition-colors"
            title="Bold"
          >
            <Bold className="w-4 h-4 text-gray-600" />
          </button>
          <button
            type="button"
            onClick={handleItalic}
            className="p-2 hover:bg-gray-100 rounded transition-colors"
            title="Italic"
          >
            <Italic className="w-4 h-4 text-gray-600" />
          </button>
          <button
            type="button"
            onClick={handleLink}
            className="p-2 hover:bg-gray-100 rounded transition-colors"
            title="Insert Link"
          >
            <Link className="w-4 h-4 text-gray-600" />
          </button>
          <button
            type="button"
            onClick={handleList}
            className="p-2 hover:bg-gray-100 rounded transition-colors"
            title="Bullet List"
          >
            <List className="w-4 h-4 text-gray-600" />
          </button>
          <div className="flex-1" />
          {hasChanges && (
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 hover:text-amber-800 hover:bg-amber-50 rounded transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset to Default
            </button>
          )}
        </div>

        {/* Email Body - Editable iframe */}
        <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden bg-gray-100">
          <iframe
            ref={iframeRef}
            title="Email Editor"
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-scripts"
          />
        </div>

        {/* No Email Warning */}
        {emails.length === 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700">
              Please add at least one email address to send the reminder.
            </p>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 overflow-hidden">
            <div className="bg-red-50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <h3 className="font-semibold text-red-900">Failed to Send</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setError('')}
                  className="text-red-400 hover:text-red-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-700">{error}</p>
            </div>
            <div className="px-4 pb-4 flex gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => setError('')}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                Try Again
              </button>
            </div>
          </div>
        </div>
      )}

      <ModalFooter>
        <Button variant="secondary" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSend} loading={loading} disabled={emails.length === 0}>
          <Send className="w-4 h-4" />
          Send Reminder
        </Button>
      </ModalFooter>
    </Modal>
  );
}
