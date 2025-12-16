'use client';

import { useState } from 'react';
import { Modal, ModalFooter, Button, Input, Textarea } from '@/components/ui';
import { CreditCard } from 'lucide-react';

interface OneTimePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId?: string;
  onPay: (data: {
    amount: number;
    cardNumber: string;
    expMonth: string;
    expYear: string;
    cvc: string;
    description?: string;
    saveCard: boolean;
  }) => Promise<void>;
}

export function OneTimePaymentModal({
  isOpen,
  onClose,
  customerId,
  onPay,
}: OneTimePaymentModalProps) {
  const [amount, setAmount] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [cvc, setCvc] = useState('');
  const [description, setDescription] = useState('');
  const [saveCard, setSaveCard] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payAmount = Math.round(parseFloat(amount) * 100);

    if (!amount || payAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!cardNumber || cardNumber.replace(/\s/g, '').length < 13) {
      setError('Please enter a valid card number');
      return;
    }

    if (!expMonth || !expYear) {
      setError('Please enter card expiration date');
      return;
    }

    if (!cvc || cvc.length < 3) {
      setError('Please enter a valid CVC');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onPay({
        amount: payAmount,
        cardNumber: cardNumber.replace(/\s/g, ''),
        expMonth,
        expYear,
        cvc,
        description: description.trim() || undefined,
        saveCard,
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process payment');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setAmount('');
    setCardNumber('');
    setExpMonth('');
    setExpYear('');
    setCvc('');
    setDescription('');
    setSaveCard(false);
    setError('');
    onClose();
  };

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    if (parts.length) {
      return parts.join(' ');
    } else {
      return value;
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="One-Time Card Payment" size="md">
      <form onSubmit={handleSubmit}>
        {/* Info */}
        <div className="bg-indigo-50 rounded-xl p-4 mb-6 border border-indigo-200">
          <div className="flex items-start gap-3">
            <CreditCard className="w-5 h-5 text-indigo-600 mt-0.5" />
            <div>
              <p className="font-medium text-indigo-800">Process a one-time payment</p>
              <p className="text-sm text-indigo-600 mt-1">
                This payment will not be linked to any existing payment.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Amount */}
          <Input
            label="Payment Amount"
            type="number"
            step="0.01"
            min="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />

          {/* Card Number */}
          <Input
            label="Card Number"
            type="text"
            placeholder="1234 5678 9012 3456"
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            maxLength={19}
          />

          {/* Expiry & CVC */}
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Month"
              type="text"
              placeholder="MM"
              value={expMonth}
              onChange={(e) => setExpMonth(e.target.value.slice(0, 2))}
              maxLength={2}
            />
            <Input
              label="Year"
              type="text"
              placeholder="YY"
              value={expYear}
              onChange={(e) => setExpYear(e.target.value.slice(0, 2))}
              maxLength={2}
            />
            <Input
              label="CVC"
              type="text"
              placeholder="123"
              value={cvc}
              onChange={(e) => setCvc(e.target.value.slice(0, 4))}
              maxLength={4}
            />
          </div>

          {/* Description */}
          <Textarea
            label="Description (optional)"
            placeholder="Enter a description for this payment..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />

          {/* Save Card Option */}
          {customerId && (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={saveCard}
                onChange={(e) => setSaveCard(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-700">
                Save this card for future payments
              </span>
            </label>
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
          <Button type="submit" loading={loading}>
            <CreditCard className="w-4 h-4" />
            Process Payment
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
