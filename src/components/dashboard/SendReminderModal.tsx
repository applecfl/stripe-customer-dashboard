'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { InvoiceData, CustomerData, PaymentMethodData } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { generatePaymentReminderHtml } from '@/lib/emailTemplate';
import { Modal, ModalFooter, Button, Input } from '@/components/ui';
import { Send, AlertCircle, CheckCircle, X, RotateCcw, Bold, Italic, Link, List } from 'lucide-react';

interface SendReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: InvoiceData | null;
  customer: CustomerData | null;
  paymentMethods: PaymentMethodData[];
  accountId: string;
  paymentLink: string;
}

export function SendReminderModal({
  isOpen,
  onClose,
  invoice,
  customer,
  paymentMethods,
  accountId,
  paymentLink,
}: SendReminderModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [subject, setSubject] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Find the payment method used (from invoice's default or customer's default)
  const paymentMethod = invoice?.default_payment_method
    ? paymentMethods.find(pm => pm.id === invoice.default_payment_method)
    : paymentMethods.find(pm => pm.isDefault) || paymentMethods[0];

  // Format the failed charge date
  const failedDate = invoice
    ? new Date(invoice.created * 1000).toLocaleDateString('en-US', {
        month: 'long',
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

  // Default subject
  const defaultSubject = `Payment Reminder - ${formattedAmount} Due`;

  // Generate the base HTML template
  const baseHtml = useMemo(() => {
    if (!invoice || !customer) return '';
    return generatePaymentReminderHtml({
      customerName: customer.name || '',
      organizationName: 'LEC',
      logoUrl: 'https://lecfl.com/wp-content/uploads/2024/08/LEC-Logo-Primary-1.png',
      failedDate,
      cardLast4: paymentMethod?.card?.last4 || null,
      cardBrand: paymentMethod?.card?.brand || null,
      formattedAmount,
      paymentLink,
    });
  }, [invoice, customer, failedDate, paymentMethod, formattedAmount, paymentLink]);

  // Initialize when modal opens
  useEffect(() => {
    if (isOpen && baseHtml) {
      setSubject(defaultSubject);
      setHasChanges(false);
    }
  }, [isOpen, baseHtml, defaultSubject]);

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
    if (!customer.email) {
      setError('Customer does not have an email address');
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
          customerName: customer.name,
          customerEmail: customer.email,
          amount: invoice.amount_due,
          currency: invoice.currency,
          failedDate,
          cardLast4: paymentMethod?.card?.last4 || null,
          cardBrand: paymentMethod?.card?.brand || null,
          paymentLink,
          accountId,
          customHtml: hasChanges ? customHtml : undefined,
          customSubject: subject !== defaultSubject ? subject : undefined,
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
            <span className="font-medium">{customer.email}</span>
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
      title="Send Payment Reminder"
      size="full"
    >
      <div className="flex flex-col h-[calc(100vh-200px)] min-h-[500px]">
        {/* Email Header - To, Subject */}
        <div className="border-b border-gray-200 pb-4 mb-4 space-y-3">
          {/* To Field */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-500 w-16">To:</label>
            <div className="flex-1 flex items-center gap-2">
              <span className="px-3 py-1.5 bg-gray-100 rounded-full text-sm font-medium text-gray-700">
                {customer.name || 'Customer'}
              </span>
              <span className="text-sm text-gray-500">&lt;{customer.email || 'No email'}&gt;</span>
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

          {/* Amount Info */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-500 w-16">Amount:</label>
            <span className="text-sm font-semibold text-red-600">
              {formatCurrency(invoice.amount_due, invoice.currency)}
            </span>
            <span className="text-sm text-gray-400">•</span>
            <span className="text-sm text-gray-500">Failed on {failedDate}</span>
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
        {!customer.email && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">
              This customer does not have an email address on file. Please add one before sending a reminder.
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
        <Button onClick={handleSend} loading={loading} disabled={!customer.email}>
          <Send className="w-4 h-4" />
          Send Reminder
        </Button>
      </ModalFooter>
    </Modal>
  );
}
