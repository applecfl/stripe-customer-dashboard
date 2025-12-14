'use client';

import { useState } from 'react';
import { InvoiceData, CustomerData, PaymentMethodData } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Modal, ModalFooter, Button } from '@/components/ui';
import { Mail, Send, AlertCircle, CheckCircle, X } from 'lucide-react';

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
  const [additionalMessage, setAdditionalMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!invoice || !customer) return null;

  // Find the payment method used (from invoice's default or customer's default)
  const paymentMethod = invoice.default_payment_method
    ? paymentMethods.find(pm => pm.id === invoice.default_payment_method)
    : paymentMethods.find(pm => pm.isDefault) || paymentMethods[0];

  // Format the failed charge date
  const failedDate = new Date(invoice.created * 1000).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const handleSend = async () => {
    if (!customer.email) {
      setError('Customer does not have an email address');
      return;
    }

    setLoading(true);
    setError('');

    try {
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
          additionalMessage: additionalMessage.trim() || undefined,
          accountId,
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
    setAdditionalMessage('');
    setError('');
    setSuccess(false);
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
    <Modal isOpen={isOpen} onClose={handleClose} title="Send Payment Reminder" size="md">
      {/* Invoice Summary */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
            <Mail className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-amber-900 mb-1">Payment Reminder Email</h3>
            <p className="text-sm text-amber-700">
              This will send a professionally designed email to the customer with a link to retry their payment.
            </p>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Recipient</span>
            <div className="text-right">
              <p className="font-medium text-gray-900">{customer.name || 'Customer'}</p>
              <p className="text-sm text-gray-600">{customer.email || 'No email'}</p>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Amount Due</span>
            <span className="font-semibold text-red-600">
              {formatCurrency(invoice.amount_due, invoice.currency)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Failed Date</span>
            <span className="text-sm text-gray-700">{failedDate}</span>
          </div>
          {paymentMethod?.card && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Card Used</span>
              <span className="text-sm text-gray-700">
                <span className="capitalize">{paymentMethod.card.brand}</span> •••• {paymentMethod.card.last4}
              </span>
            </div>
          )}
        </div>

        {/* Additional Message */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Additional Message (optional)
          </label>
          <textarea
            value={additionalMessage}
            onChange={(e) => setAdditionalMessage(e.target.value)}
            placeholder="Add a personal note to the customer..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            rows={3}
          />
          <p className="text-xs text-gray-500 mt-1">
            This message will appear in a highlighted box in the email.
          </p>
        </div>
      </div>

      {/* No Email Warning */}
      {!customer.email && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">
            This customer does not have an email address on file. Please add one before sending a reminder.
          </p>
        </div>
      )}

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
            <div className="px-4 pb-4">
              <button
                type="button"
                onClick={() => setError('')}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
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
