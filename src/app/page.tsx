'use client';

import { useState, useEffect, useCallback, Suspense, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  CustomerData,
  InvoiceData,
  PaymentData,
  PaymentMethodData,
  CreditBalanceTransaction,
  ExtendedCustomerInfo,
  OtherPayment,
} from '@/types';
import { LoadingState } from '@/components/ui';
import {
  CustomerHeader,
  FailedPaymentsTable,
  SuccessfulPaymentsTable,
  FutureInvoicesTable,
  PaymentMethodsTable,
  PaymentModal,
  VoidInvoiceModal,
  AdjustInvoiceModal,
  RefundModal,
  AddPaymentMethodModal,
  ChangePaymentMethodModal,
  ChangeDueDateModal,
  RetryPaymentModal,
  SendReminderModal,
} from '@/components/dashboard';
import { AlertCircle, RefreshCw, CreditCard, AlertTriangle, CheckCircle, Clock, Loader2 } from 'lucide-react';

// Token refresh interval (25 minutes in ms - refresh before 30 min expiry)
const TOKEN_REFRESH_INTERVAL = 25 * 60 * 1000;

// Helper to decode token payload (client-side)
interface DecodedTokenPayload {
  customerId: string;
  invoiceUID: string;
  accountId: string;
  extendedInfo?: ExtendedCustomerInfo;
  otherPayments?: OtherPayment[];
}

function decodeTokenPayload(token: string): DecodedTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payloadStr = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadStr);
    if (payload.customerId && payload.invoiceUID && payload.accountId) {
      return {
        customerId: payload.customerId,
        invoiceUID: payload.invoiceUID,
        accountId: payload.accountId,
        extendedInfo: payload.extendedInfo,
        otherPayments: payload.otherPayments,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialToken = searchParams.get('token') || '';

  // Try to extract values from token first, fallback to URL params
  const tokenPayload = initialToken ? decodeTokenPayload(initialToken) : null;
  const customerId = tokenPayload?.customerId || searchParams.get('customerId') || '';
  const invoiceUID = tokenPayload?.invoiceUID || searchParams.get('invoiceUID') || '';
  const accountId = tokenPayload?.accountId || searchParams.get('accountId') || '';
  const extendedInfo = tokenPayload?.extendedInfo;
  const otherPayments = tokenPayload?.otherPayments;

  // Track the current valid token (may be refreshed)
  const [token, setToken] = useState(initialToken);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Data state
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [payments, setPayments] = useState<PaymentData[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodData[]>([]);
  const [creditTransactions, setCreditTransactions] = useState<CreditBalanceTransaction[]>([]);

  // Calculate outstanding amount (in cents) - same logic as CustomerHeader
  const outstandingAmount = useMemo(() => {
    // Paid = successful payments + other payments (Zelle, Cash, etc.)
    const paidFromStripe = payments
      .filter(p => p.status === 'succeeded')
      .reduce((sum, p) => sum + (p.amount - p.amount_refunded), 0);
    const paidFromOther = otherPayments?.reduce((sum, p) => sum + (p.amount * 100), 0) || 0;
    const paid = paidFromStripe + paidFromOther;

    // Scheduled = draft invoices
    const scheduled = invoices
      .filter(inv => inv.status === 'draft')
      .reduce((sum, inv) => sum + inv.amount_due, 0);

    // Failed = open invoices with attempt_count > 0
    const failed = invoices
      .filter(inv => inv.status === 'open' && inv.attempt_count > 0)
      .reduce((sum, inv) => sum + inv.amount_remaining, 0);

    // Total from token
    const totalFromToken = extendedInfo?.totalAmount ? extendedInfo.totalAmount * 100 : 0;
    const total = totalFromToken > 0 ? totalFromToken : (paid + scheduled + failed);

    // Outstanding = total - paid - scheduled - failed
    return Math.max(0, total - paid - scheduled - failed);
  }, [payments, invoices, otherPayments, extendedInfo]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'failed' | 'success' | 'future' | 'payment-methods'>('failed');
  const [initialTabSet, setInitialTabSet] = useState(false);
  const [isChildUpdating, setIsChildUpdating] = useState(false);

  // Modal state
  const [paymentModal, setPaymentModal] = useState<{ isOpen: boolean; invoice?: InvoiceData | null }>({ isOpen: false });
  const [voidInvoiceModal, setVoidInvoiceModal] = useState<InvoiceData | null>(null);
  const [adjustInvoiceModal, setAdjustInvoiceModal] = useState<InvoiceData | null>(null);
  const [refundModal, setRefundModal] = useState<PaymentData | null>(null);
  const [retryModal, setRetryModal] = useState<InvoiceData | null>(null);
  const [sendReminderModal, setSendReminderModal] = useState<InvoiceData | null>(null);
  const [showAddPaymentMethodModal, setShowAddPaymentMethodModal] = useState(false);
  const [changePaymentMethodModal, setChangePaymentMethodModal] = useState<InvoiceData | null>(null);
  const [showBulkChangePaymentMethodModal, setShowBulkChangePaymentMethodModal] = useState(false);
  const [changeDueDateModal, setChangeDueDateModal] = useState<InvoiceData | null>(null);
  const [showBulkChangeDueDateModal, setShowBulkChangeDueDateModal] = useState(false);

  // Check if response indicates session expired (401) and redirect
  const checkSessionExpired = useCallback((response: Response) => {
    if (response.status === 401) {
      router.push('/expired');
      return true;
    }
    return false;
  }, [router]);

  // Fetch all data - isBackground = true means don't show full loading state
  const fetchData = useCallback(async (isBackground = false) => {
    if (!customerId || !invoiceUID || !accountId) {
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
      const accountParam = `&accountId=${encodeURIComponent(accountId)}`;
      const cacheBust = `&_t=${Date.now()}`;
      const [customerRes, invoicesRes, paymentsRes, paymentMethodsRes] = await Promise.all([
        fetch(`/api/stripe/customer/${customerId}?token=${encodeURIComponent(token)}${accountParam}${cacheBust}`),
        fetch(`/api/stripe/invoices?customerId=${customerId}&invoiceUID=${invoiceUID}${tokenParam}${accountParam}${cacheBust}`),
        fetch(`/api/stripe/payments?customerId=${customerId}&invoiceUID=${invoiceUID}${tokenParam}${accountParam}${cacheBust}`),
        fetch(`/api/stripe/payment-methods?customerId=${customerId}${tokenParam}${accountParam}${cacheBust}`),
      ]);

      // Check if any response indicates session expired
      if (checkSessionExpired(customerRes) || checkSessionExpired(invoicesRes) ||
        checkSessionExpired(paymentsRes) || checkSessionExpired(paymentMethodsRes)) {
        return;
      }

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
  }, [customerId, invoiceUID, token, checkSessionExpired]);

  // Background refresh helper
  const refreshData = useCallback(() => fetchData(true), [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Set initial tab based on whether there are failed payments (only once on load)
  useEffect(() => {
    if (!loading && !initialTabSet && invoices.length > 0) {
      const hasFailedPayments = invoices.some(inv => inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0);
      if (!hasFailedPayments) {
        setActiveTab('success');
      }
      setInitialTabSet(true);
    }
  }, [loading, initialTabSet, invoices]);

  // Token refresh mechanism - refresh before expiry while page is open
  useEffect(() => {
    if (!token) return;

    const refreshToken = async () => {
      try {
        const response = await fetch('/api/auth/refresh-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const result = await response.json();

        if (result.success && result.token) {
          // Update the token state
          setToken(result.token);

          // Update the URL with new token (without reload)
          const url = new URL(window.location.href);
          url.searchParams.set('token', result.token);
          router.replace(url.pathname + url.search, { scroll: false });

          console.log('Token refreshed successfully');
        } else {
          console.warn('Token refresh failed:', result.error);
        }
      } catch (error) {
        console.error('Error refreshing token:', error);
      }
    };

    // Schedule token refresh
    refreshTimeoutRef.current = setTimeout(refreshToken, TOKEN_REFRESH_INTERVAL);

    // Cleanup on unmount or token change
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [token, router]);

  // Helper to add token and accountId to API URLs
  const withToken = (url: string) => {
    let result = url;
    if (token) {
      const separator = result.includes('?') ? '&' : '?';
      result = `${result}${separator}token=${encodeURIComponent(token)}`;
    }
    if (accountId) {
      const separator = result.includes('?') ? '&' : '?';
      result = `${result}${separator}accountId=${encodeURIComponent(accountId)}`;
    }
    return result;
  };

  // Wrapper for fetch that checks for session expiration
  const fetchWithAuth = async (url: string, options?: RequestInit) => {
    const response = await fetch(url, options);
    if (response.status === 401) {
      router.push('/expired');
      throw new Error('Session expired');
    }
    return response;
  };

  // Action handlers
  const handleVoidInvoice = async (data: {
    invoiceId: string;
    addCredit: boolean;
    reason?: string;
  }) => {
    const response = await fetchWithAuth(withToken(`/api/stripe/invoices/${data.invoiceId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'void',
        addCredit: data.addCredit,
        reason: data.reason,
        accountId,
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
      const response = await fetchWithAuth(withToken(`/api/stripe/invoices/${invoice.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause', pause, accountId }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      await refreshData();
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return;
      setError(err instanceof Error ? err.message : 'Failed to update payment');
    }
  };

  const handleAdjustInvoice = async (data: {
    invoiceId: string;
    newAmount: number;
    reason: string;
  }) => {
    const response = await fetchWithAuth(withToken(`/api/stripe/invoices/${data.invoiceId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'adjust',
        newAmount: data.newAmount,
        reason: data.reason,
        accountId,
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
      const response = await fetchWithAuth(withToken(`/api/stripe/invoices/${invoice.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-reminder', accountId }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      await refreshData();
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return;
      setError(err instanceof Error ? err.message : 'Failed to send reminder');
    }
  };

  const handleDeleteInvoice = async (invoice: InvoiceData) => {
    try {
      const response = await fetchWithAuth(withToken(`/api/stripe/invoices/${invoice.id}`), {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      await refreshData();
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return;
      setError(err instanceof Error ? err.message : 'Failed to delete payment');
    }
  };

  const handleRetryInvoice = async (data: { invoiceId: string; paymentMethodId?: string }) => {
    const response = await fetchWithAuth(withToken(`/api/stripe/invoices/${data.invoiceId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry', accountId, paymentMethodId: data.paymentMethodId }),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }

    await refreshData();
  };

  const handleRefund = async (data: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
  }) => {
    const response = await fetchWithAuth(withToken('/api/stripe/refunds'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, accountId }),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error);
    }

    await refreshData();
  };

  const handleSetDefaultPaymentMethod = async (pm: PaymentMethodData) => {
    try {
      const response = await fetchWithAuth(withToken('/api/stripe/payment-methods'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId,
          paymentMethodId: pm.id,
          setAsDefault: true,
          accountId,
        }),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      await refreshData();
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return;
      setError(err instanceof Error ? err.message : 'Failed to update payment method');
    }
  };

  const handleDeletePaymentMethod = async (pm: PaymentMethodData) => {
    try {
      const response = await fetchWithAuth(withToken(`/api/stripe/payment-methods?paymentMethodId=${pm.id}`), {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error);
      }

      // Optimistic update - remove from list immediately
      setPaymentMethods(prev => prev.filter(p => p.id !== pm.id));
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return;
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
          const response = await fetchWithAuth(withToken(`/api/stripe/payment-methods?paymentMethodId=${pmId}`), {
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
      if (err instanceof Error && err.message === 'Session expired') return;
      setError(err instanceof Error ? err.message : 'Failed to delete payment methods');
      await refreshData(); // Refresh on error to restore correct state
    }
  };

  const handleChangePaymentMethod = async (invoiceIds: string[], paymentMethodId: string) => {
    // Update each invoice's payment method
    const results = await Promise.all(
      invoiceIds.map(async (invoiceId) => {
        const response = await fetchWithAuth(withToken(`/api/stripe/invoices/${invoiceId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'change-payment-method',
            paymentMethodId,
            accountId,
          }),
        });
        return response.json();
      })
    );

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      throw new Error(`Failed to update ${failed.length} payment(s)`);
    }

    await refreshData();
  };

  const handleChangeDueDate = async (invoiceIds: string[], newDueDate: number) => {
    // Update each invoice's due date
    const results = await Promise.all(
      invoiceIds.map(async (invoiceId) => {
        const response = await fetchWithAuth(withToken(`/api/stripe/invoices/${invoiceId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'change-due-date',
            newDueDate,
            accountId,
          }),
        });
        return response.json();
      })
    );

    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      throw new Error(`Failed to update ${failed.length} payment(s)`);
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
      if (err instanceof Error && err.message === 'Session expired') return;
      setError(err instanceof Error ? err.message : 'Failed to pause/resume payments');
    }
  };

  const handleBulkDeleteDrafts = async (invoiceIds: string[]) => {
    try {
      await Promise.all(
        invoiceIds.map(async (invoiceId) => {
          const response = await fetchWithAuth(withToken(`/api/stripe/invoices/${invoiceId}`), {
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
      if (err instanceof Error && err.message === 'Session expired') return;
      setError(err instanceof Error ? err.message : 'Failed to delete payments');
    }
  };

  // Show error if missing required params
  if (!customerId || !invoiceUID || !accountId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Missing Parameters</h2>
          <p className="text-gray-500 mb-4">
            Please provide <code className="bg-gray-100 px-1 rounded">customerId</code>,{' '}
            <code className="bg-gray-100 px-1 rounded">invoiceUID</code>, and{' '}
            <code className="bg-gray-100 px-1 rounded">accountId</code> query parameters.
          </p>
          <p className="text-sm text-gray-400">
            Example: <code className="bg-gray-100 px-1 rounded text-xs">/?customerId=cus_xxx&invoiceUID=your-uid&accountId=111</code>
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
            onClick={() => fetchData()}
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


  // Global loading state - combines parent refreshing with child updating
  const isGlobalUpdating = refreshing || isChildUpdating;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Global Fixed Loading Indicator - Bottom Right */}
      {isGlobalUpdating && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 bg-white border border-gray-200 rounded-full shadow-xl">
          <div className="relative">
            <div className="w-5 h-5 border-2 border-indigo-200 rounded-full"></div>
            <div className="absolute inset-0 w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <span className="text-base font-medium text-gray-700">Syncing...</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img
              src="https://lecfl.com/wp-content/uploads/2024/08/LEC-Logo-Primary-1.png"
              alt="LEC Logo"
              className="h-6 sm:h-8 w-auto flex-shrink-0"
            />
            <span className="font-semibold text-gray-900 text-sm sm:text-base truncate">Payment Manager</span>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border-b border-red-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
            <div className="flex items-center gap-3 text-red-800">
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-red-600" />
              </div>
              <span className="text-sm font-medium flex-1">{error}</span>
              <button
                onClick={() => setError(null)}
                className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-full hover:bg-red-200 transition-colors flex-shrink-0"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 space-y-4 sm:space-y-8">
        {/* Customer Header */}
        <CustomerHeader
          customer={customer}
          extendedInfo={extendedInfo}
          invoiceUID={invoiceUID}
          invoices={invoices}
          payments={payments}
          otherPayments={otherPayments}
          onAddPaymentMethod={() => setShowAddPaymentMethodModal(true)}
          onPayNow={() => setPaymentModal({ isOpen: true })}
          onTabChange={setActiveTab}
        />

        {/* Tabs */}
        <div className="border-b border-gray-200 -mx-4 sm:mx-0 px-4 sm:px-0">
          <nav className="flex gap-2 sm:gap-6 overflow-x-auto">
            <button
              onClick={() => setActiveTab('success')}
              className={`flex items-center gap-1.5 sm:gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${activeTab === 'success'
                  ? 'border-green-600 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <CheckCircle className="w-4 h-4" />
              <span className="hidden sm:inline">Success</span>
              <span className="sm:hidden">Success</span>
              <span className={`px-1.5 sm:px-2 py-0.5 rounded-full text-xs ${activeTab === 'success' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
                }`}>
                {payments.filter(p => p.status === 'succeeded').length + (otherPayments?.length || 0)}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('future')}
              className={`flex items-center gap-1.5 sm:gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${activeTab === 'future'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <Clock className="w-4 h-4" />
              <span className="hidden sm:inline">Scheduled</span>
              <span className="sm:hidden">Scheduled</span>
              <span className={`px-1.5 sm:px-2 py-0.5 rounded-full text-xs ${activeTab === 'future' ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-600'
                }`}>
                {invoices.filter(inv => inv.status === 'draft').length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('failed')}
              className={`flex items-center gap-1.5 sm:gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${activeTab === 'failed'
                  ? 'border-red-600 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <AlertTriangle className="w-4 h-4" />
              <span className="hidden sm:inline">Failed</span>
              <span className="sm:hidden">Failed</span>
              <span className={`px-1.5 sm:px-2 py-0.5 rounded-full text-xs ${activeTab === 'failed' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'
                }`}>
                {invoices.filter(inv => inv.status === 'open' && inv.amount_remaining > 0 && inv.attempt_count > 0).length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('payment-methods')}
              className={`flex items-center gap-1.5 sm:gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${activeTab === 'payment-methods'
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <CreditCard className="w-4 h-4" />
              <span className="hidden sm:inline">Payment Methods</span>
              <span className="sm:hidden">Cards</span>
              <span className={`px-1.5 sm:px-2 py-0.5 rounded-full text-xs ${activeTab === 'payment-methods' ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-600'
                }`}>
                {paymentMethods.length}
              </span>
            </button>
          </nav>
        </div>

        {/* Tab Content - FailedPaymentsTable always mounted to preserve cached data */}
        <div className={activeTab === 'failed' ? '' : 'hidden'}>
          <FailedPaymentsTable
            invoices={invoices}
            token={token}
            accountId={accountId}
            onRefresh={refreshData}
            onPayInvoice={(invoice) => setPaymentModal({ isOpen: true, invoice })}
            onVoidInvoice={setVoidInvoiceModal}
            onPauseInvoice={handlePauseInvoice}
            onRetryInvoice={setRetryModal}
            onSendReminder={setSendReminderModal}
            onUpdatingChange={setIsChildUpdating}
          />
        </div>

        {activeTab === 'success' && (
          <SuccessfulPaymentsTable
            invoices={invoices}
            payments={payments}
            paymentMethods={paymentMethods}
            otherPayments={otherPayments}
            onRefund={setRefundModal}
            onRefresh={refreshData}
            token={token || undefined}
            accountId={accountId || undefined}
          />
        )}

        {activeTab === 'future' && (
          <FutureInvoicesTable
            invoices={invoices}
            paymentMethods={paymentMethods}
            token={token}
            accountId={accountId}
            onRefresh={refreshData}
            onUpdatingChange={setIsChildUpdating}
            onAddCard={() => setShowAddPaymentMethodModal(true)}
          />
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
                  Change Payment Method for All Payments
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
        accountId={accountId}
        onSuccess={refreshData}
        onPaymentMethodAdded={refreshData}
        outstandingAmount={outstandingAmount}
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

      <RetryPaymentModal
        isOpen={!!retryModal}
        onClose={() => setRetryModal(null)}
        invoice={retryModal}
        paymentMethods={paymentMethods}
        customerId={customer.id}
        onRetry={handleRetryInvoice}
        onPaymentMethodAdded={refreshData}
      />

      <SendReminderModal
        isOpen={!!sendReminderModal}
        onClose={() => setSendReminderModal(null)}
        invoice={sendReminderModal}
        customer={customer}
        paymentMethods={paymentMethods}
        accountId={accountId}
        paymentLink={sendReminderModal?.hosted_invoice_url || ''}
        extendedInfo={extendedInfo}
      />

      <AddPaymentMethodModal
        isOpen={showAddPaymentMethodModal}
        onClose={() => setShowAddPaymentMethodModal(false)}
        customerId={customerId}
        accountId={accountId}
        token={token}
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
        accountId={accountId}
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
        accountId={accountId}
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
