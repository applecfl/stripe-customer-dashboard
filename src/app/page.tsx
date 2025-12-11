'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CustomerData,
  InvoiceData,
  PaymentData,
  PaymentMethodData,
  CreditBalanceTransaction,
} from '@/types';
import { LoadingState } from '@/components/ui';
import {
  CustomerHeader,
  TransactionsTable,
  FutureInvoicesTable,
  PaymentMethodsTable,
  PaymentModal,
  VoidInvoiceModal,
  AdjustInvoiceModal,
  RefundModal,
  AddPaymentMethodModal,
  ChangePaymentMethodModal,
  ChangeDueDateModal,
} from '@/components/dashboard';
import { AlertCircle, RefreshCw, FileText, CreditCard } from 'lucide-react';

function DashboardContent() {
  const searchParams = useSearchParams();
  const customerId = searchParams.get('customerId') || '';
  const invoiceUID = searchParams.get('invoiceUID') || '';
  const token = searchParams.get('token') || '';

  // Data state
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [payments, setPayments] = useState<PaymentData[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodData[]>([]);
  const [creditTransactions, setCreditTransactions] = useState<CreditBalanceTransaction[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'invoices' | 'payment-methods'>('invoices');

  // Modal state
  const [paymentModal, setPaymentModal] = useState<{ isOpen: boolean; invoice?: InvoiceData | null }>({ isOpen: false });
  const [voidInvoiceModal, setVoidInvoiceModal] = useState<InvoiceData | null>(null);
  const [adjustInvoiceModal, setAdjustInvoiceModal] = useState<InvoiceData | null>(null);
  const [refundModal, setRefundModal] = useState<PaymentData | null>(null);
  const [showAddPaymentMethodModal, setShowAddPaymentMethodModal] = useState(false);
  const [changePaymentMethodModal, setChangePaymentMethodModal] = useState<InvoiceData | null>(null);
  const [showBulkChangePaymentMethodModal, setShowBulkChangePaymentMethodModal] = useState(false);
  const [changeDueDateModal, setChangeDueDateModal] = useState<InvoiceData | null>(null);
  const [showBulkChangeDueDateModal, setShowBulkChangeDueDateModal] = useState(false);

  // Fetch all data - isBackground = true means don't show full loading state
  const fetchData = useCallback(async (isBackground = false) => {
    if (!customerId || !invoiceUID) {
      setLoading(false);
      return;
    }

    try {
      if (isBackground) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      // Fetch all data in parallel (include token for auth)
      // Add timestamp to bust cache and ensure fresh data
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
      const cacheBust = `&_t=${Date.now()}`;
      const [customerRes, invoicesRes, paymentsRes, paymentMethodsRes] = await Promise.all([
        fetch(`/api/stripe/customer/${customerId}?token=${encodeURIComponent(token)}${cacheBust}`),
        fetch(`/api/stripe/invoices?customerId=${customerId}&invoiceUID=${invoiceUID}${tokenParam}${cacheBust}`),
        fetch(`/api/stripe/payments?customerId=${customerId}&invoiceUID=${invoiceUID}${tokenParam}${cacheBust}`),
        fetch(`/api/stripe/payment-methods?customerId=${customerId}${tokenParam}${cacheBust}`),
      ]);

      const [customerData, invoicesData, paymentsData, paymentMethodsData] = await Promise.all([
        customerRes.json(),
        invoicesRes.json(),
        paymentsRes.json(),
        paymentMethodsRes.json(),
      ]);

      if (!customerData.success) {
        throw new Error(customerData.error || 'Failed to fetch customer');
      }

      setCustomer(customerData.data.customer);
      setCreditTransactions(customerData.data.creditTransactions);
      setInvoices(invoicesData.data || []);
      setPayments(paymentsData.data || []);
      setPaymentMethods(paymentMethodsData.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [customerId, invoiceUID, token]);

  // Background refresh helper
  const refreshData = useCallback(() => fetchData(true), [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Helper to add token to API URLs
  const withToken = (url: string) => {
    if (!token) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  };

  // Action handlers
  const handleVoidInvoice = async (data: {
    invoiceId: string;
    addCredit: boolean;
    reason?: string;
  }) => {
    const response = await fetch(withToken(`/api/stripe/invoices/${data.invoiceId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'void',
        addCredit: data.addCredit,
        reason: data.reason,
      }),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }

    await refreshData();
  };

  const handlePauseInvoice = async (invoice: InvoiceData, pause: boolean) => {
    try {
      const response = await fetch(withToken(`/api/stripe/invoices/${invoice.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause', pause }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update invoice');
    }
  };

  const handleAdjustInvoice = async (data: {
    invoiceId: string;
    newAmount: number;
    reason: string;
  }) => {
    const response = await fetch(withToken(`/api/stripe/invoices/${data.invoiceId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'adjust',
        newAmount: data.newAmount,
        reason: data.reason,
      }),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }

    await refreshData();
  };

  const handleSendReminder = async (invoice: InvoiceData) => {
    try {
      const response = await fetch(withToken(`/api/stripe/invoices/${invoice.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-reminder' }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reminder');
    }
  };

  const handleDeleteInvoice = async (invoice: InvoiceData) => {
    try {
      const response = await fetch(withToken(`/api/stripe/invoices/${invoice.id}`), {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete invoice');
    }
  };

  const handleRetryInvoice = async (invoice: InvoiceData) => {
    try {
      const response = await fetch(withToken(`/api/stripe/invoices/${invoice.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry' }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry payment');
    }
  };

  const handleRefund = async (data: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
  }) => {
    const response = await fetch(withToken('/api/stripe/refunds'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }

    await refreshData();
  };

  const handleSetDefaultPaymentMethod = async (pm: PaymentMethodData) => {
    try {
      const response = await fetch(withToken('/api/stripe/payment-methods'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          paymentMethodId: pm.id,
          setAsDefault: true,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update payment method');
    }
  };

  const handleDeletePaymentMethod = async (pm: PaymentMethodData) => {
    try {
      const response = await fetch(withToken(`/api/stripe/payment-methods?paymentMethodId=${pm.id}`), {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      // Optimistic update - remove from list immediately
      setPaymentMethods(prev => prev.filter(p => p.id !== pm.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete payment method');
      await refreshData(); // Refresh on error to restore correct state
    }
  };

  const handleBatchDeletePaymentMethods = async (pmIds: string[]) => {
    try {
      // Optimistic update - remove from list immediately
      setPaymentMethods(prev => prev.filter(p => !pmIds.includes(p.id)));

      // Delete payment methods in parallel
      const results = await Promise.all(
        pmIds.map(async (pmId) => {
          const response = await fetch(withToken(`/api/stripe/payment-methods?paymentMethodId=${pmId}`), {
            method: 'DELETE',
          });
          return response.json();
        })
      );

      const failed = results.filter(r => !r.success);
      if (failed.length > 0) {
        throw new Error(`Failed to delete ${failed.length} payment method(s)`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete payment methods');
      await refreshData(); // Refresh on error to restore correct state
    }
  };

  const handleChangePaymentMethod = async (invoiceIds: string[], paymentMethodId: string) => {
    // Update each invoice's payment method
    const results = await Promise.all(
      invoiceIds.map(async (invoiceId) => {
        const response = await fetch(withToken(`/api/stripe/invoices/${invoiceId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'change-payment-method',
            paymentMethodId,
          }),
        });
        return response.json();
      })
    );

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      throw new Error(`Failed to update ${failed.length} invoice(s)`);
    }

    await refreshData();
  };

  const handleChangeDueDate = async (invoiceIds: string[], newDueDate: number) => {
    // Update each invoice's due date
    const results = await Promise.all(
      invoiceIds.map(async (invoiceId) => {
        const response = await fetch(withToken(`/api/stripe/invoices/${invoiceId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'change-due-date',
            newDueDate,
          }),
        });
        return response.json();
      })
    );

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      throw new Error(`Failed to update ${failed.length} invoice(s)`);
    }

    await refreshData();
  };

  const handleBulkPauseDrafts = async (pause: boolean) => {
    const draftInvoices = invoices.filter(inv => inv.status === 'draft');
    try {
      await Promise.all(
        draftInvoices.map(inv => handlePauseInvoice(inv, pause))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause/resume invoices');
    }
  };

  const handleBulkDeleteDrafts = async (invoiceIds: string[]) => {
    try {
      await Promise.all(
        invoiceIds.map(async (invoiceId) => {
          const response = await fetch(withToken(`/api/stripe/invoices/${invoiceId}`), {
            method: 'DELETE',
          });
          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error);
          }
        })
      );
      await refreshData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete invoices');
    }
  };

  // Show error if missing required params
  if (!customerId || !invoiceUID) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Missing Parameters</h2>
          <p className="text-gray-500 mb-4">
            Please provide both <code className="bg-gray-100 px-1 rounded">customerId</code> and{' '}
            <code className="bg-gray-100 px-1 rounded">invoiceUID</code> query parameters.
          </p>
          <p className="text-sm text-gray-400">
            Example: <code className="bg-gray-100 px-1 rounded text-xs">/?customerId=cus_xxx&invoiceUID=your-uid</code>
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingState message="Loading customer data..." />
      </div>
    );
  }

  if (error && !customer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Data</h2>
          <p className="text-gray-500 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!customer) {
    return null;
  }


  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header Bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img
                src="https://lecfl.com/wp-content/uploads/2024/08/LEC-Logo-Primary-1.png"
                alt="LEC Logo"
                className="h-8 w-auto"
              />
              <span className="font-semibold text-gray-900">LEC - Payment Manager</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {refreshing && (
                <div className="flex items-center gap-2 text-indigo-600">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span className="text-xs">Updating...</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-gray-500">Invoice UID:</span>
                <code className="px-2 py-1 bg-gray-100 rounded text-gray-700 font-mono text-xs">
                  {invoiceUID}
                </code>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border-b border-red-200">
          <div className="max-w-7xl mx-auto px-6 py-3">
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
              <button
                onClick={() => setError(null)}
                className="ml-auto text-sm underline hover:no-underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Customer Header */}
        <CustomerHeader
          customer={customer}
          onAddPaymentMethod={() => setShowAddPaymentMethodModal(true)}
          onPayNow={() => setPaymentModal({ isOpen: true })}
        />

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-8">
            <button
              onClick={() => setActiveTab('invoices')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'invoices'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <FileText className="w-4 h-4" />
              Transactions
              <span className={`px-2 py-0.5 rounded-full text-xs ${
                activeTab === 'invoices' ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-600'
              }`}>
                {invoices.length + payments.filter(p => p.status === 'succeeded').length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('payment-methods')}
              className={`flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === 'payment-methods'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <CreditCard className="w-4 h-4" />
              Payment Methods
              <span className={`px-2 py-0.5 rounded-full text-xs ${
                activeTab === 'payment-methods' ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-600'
              }`}>
                {paymentMethods.length}
              </span>
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'invoices' && (
          <div className="space-y-6">
            {/* Active Transactions (Failed, Open invoices, Payments) */}
            <TransactionsTable
              invoices={invoices}
              payments={payments}
              paymentMethods={paymentMethods}
              onPayInvoice={(invoice) => setPaymentModal({ isOpen: true, invoice })}
              onVoidInvoice={setVoidInvoiceModal}
              onPauseInvoice={handlePauseInvoice}
              onRetryInvoice={handleRetryInvoice}
              onRefund={setRefundModal}
            />

            {/* Future Invoices - separate table with bulk actions */}
            <FutureInvoicesTable
              invoices={invoices}
              paymentMethods={paymentMethods}
              token={token}
              onRefresh={refreshData}
            />
          </div>
        )}

        {activeTab === 'payment-methods' && (
          <div className="space-y-4">
            {/* Bulk Actions */}
            {invoices.filter(inv => inv.status === 'open' || inv.status === 'draft').length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={() => setShowBulkChangePaymentMethodModal(true)}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  <CreditCard className="w-4 h-4" />
                  Change Payment Method for All Invoices
                </button>
              </div>
            )}
            <PaymentMethodsTable
              paymentMethods={paymentMethods}
              invoices={invoices}
              onSetDefault={handleSetDefaultPaymentMethod}
              onDelete={handleDeletePaymentMethod}
              onBatchDelete={handleBatchDeletePaymentMethods}
              onAddCard={() => setShowAddPaymentMethodModal(true)}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      <PaymentModal
        isOpen={paymentModal.isOpen}
        onClose={() => setPaymentModal({ isOpen: false })}
        invoice={paymentModal.invoice}
        invoices={invoices}
        paymentMethods={paymentMethods}
        customerId={customerId}
        invoiceUID={invoiceUID}
        currency={customer.currency}
        token={token}
        onSuccess={refreshData}
        onPaymentMethodAdded={refreshData}
      />

      <VoidInvoiceModal
        isOpen={!!voidInvoiceModal}
        onClose={() => setVoidInvoiceModal(null)}
        invoice={voidInvoiceModal}
        onVoid={handleVoidInvoice}
      />

      <AdjustInvoiceModal
        isOpen={!!adjustInvoiceModal}
        onClose={() => setAdjustInvoiceModal(null)}
        invoice={adjustInvoiceModal}
        onAdjust={handleAdjustInvoice}
      />

      <RefundModal
        isOpen={!!refundModal}
        onClose={() => setRefundModal(null)}
        payment={refundModal}
        onRefund={handleRefund}
      />

      <AddPaymentMethodModal
        isOpen={showAddPaymentMethodModal}
        onClose={() => setShowAddPaymentMethodModal(false)}
        customerId={customerId}
        onSuccess={refreshData}
      />

      <ChangePaymentMethodModal
        isOpen={!!changePaymentMethodModal}
        onClose={() => setChangePaymentMethodModal(null)}
        invoice={changePaymentMethodModal}
        paymentMethods={paymentMethods}
        onChangePaymentMethod={handleChangePaymentMethod}
        onPaymentMethodAdded={refreshData}
        customerId={customer.id}
        mode="single"
      />

      <ChangePaymentMethodModal
        isOpen={showBulkChangePaymentMethodModal}
        onClose={() => setShowBulkChangePaymentMethodModal(false)}
        invoice={null}
        invoices={invoices}
        paymentMethods={paymentMethods}
        onChangePaymentMethod={handleChangePaymentMethod}
        onPaymentMethodAdded={refreshData}
        customerId={customer.id}
        mode="bulk"
      />

      <ChangeDueDateModal
        isOpen={!!changeDueDateModal}
        onClose={() => setChangeDueDateModal(null)}
        invoice={changeDueDateModal}
        onChangeDueDate={handleChangeDueDate}
        mode="single"
      />

      <ChangeDueDateModal
        isOpen={showBulkChangeDueDateModal}
        onClose={() => setShowBulkChangeDueDateModal(false)}
        invoice={null}
        invoices={invoices}
        onChangeDueDate={handleChangeDueDate}
        mode="bulk"
      />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingState message="Loading..." />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
