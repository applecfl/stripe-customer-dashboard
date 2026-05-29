import { CheckCircle, AlertCircle } from 'lucide-react';
import { verifyToken, getTokenSignature } from '@/lib/auth';
import { getPaymentLink } from '@/lib/paymentLinks';
import { getStripeForAccount, getStripeAccountInfo } from '@/lib/stripe';
import { PaymentMethodData } from '@/types';
import { PayLinkForm } from '@/components/pay/PayLinkForm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Middleware guarantees a valid payment_link token reached this route, but we
// re-verify here too (single source of truth) and load everything server-side.
export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const payload = token ? verifyToken(token) : null;
  if (!token || !payload || payload.kind !== 'payment_link' || !payload.amount) {
    return <Centered icon="error" title="Invalid or expired link"
      message="This payment link is no longer valid. Please request a new one." />;
  }

  // Already used?
  const record = await getPaymentLink(getTokenSignature(token));
  if (record?.status === 'paid') {
    return <Centered icon="check" title="Already paid"
      message="This payment link has already been used. No further action is needed." />;
  }

  const { customerId, accountId, amount } = payload;

  // Load saved cards + publishable key + customer name server-side.
  let savedMethods: PaymentMethodData[] = [];
  let customerName = '';
  let publishableKey = '';
  try {
    const stripe = getStripeForAccount(accountId!);
    publishableKey = getStripeAccountInfo(accountId!)?.publishableKey || '';

    const customer = await stripe.customers.retrieve(customerId);
    if (!('deleted' in customer && customer.deleted)) {
      customerName = customer.name || '';
    }
    const defaultPmId = !('deleted' in customer && customer.deleted) &&
      typeof customer.invoice_settings?.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : null;

    const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 10 });
    savedMethods = pms.data.map((pm) => ({
      id: pm.id,
      type: pm.type,
      card: pm.card
        ? { brand: pm.card.brand, last4: pm.card.last4, exp_month: pm.card.exp_month, exp_year: pm.card.exp_year }
        : undefined,
      created: pm.created,
      isDefault: pm.id === defaultPmId,
    }));
  } catch (e) {
    console.error('pay page load error:', e);
    return <Centered icon="error" title="Something went wrong"
      message="We couldn't load this payment. Please try again later." />;
  }

  if (!publishableKey) {
    return <Centered icon="error" title="Payment unavailable"
      message="This account is not configured for online payments." />;
  }

  const description = payload.extendedInfo?.paymentName || 'Outstanding balance';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-6">
          <span className="text-lg font-semibold text-gray-900">
            {customerName ? `Hi ${customerName.split(' ')[0]},` : 'Payment'}
          </span>
        </div>
        <PayLinkForm
          token={token}
          accountId={accountId!}
          amount={amount}
          customerName={customerName}
          description={description}
          publishableKey={publishableKey}
          savedMethods={savedMethods}
        />
      </div>
    </div>
  );
}

function Centered({ icon, title, message }: { icon: 'check' | 'error'; title: string; message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
          icon === 'check' ? 'bg-green-100' : 'bg-amber-100'
        }`}>
          {icon === 'check'
            ? <CheckCircle className="w-9 h-9 text-green-600" />
            : <AlertCircle className="w-9 h-9 text-amber-600" />}
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600 text-sm">{message}</p>
      </div>
    </div>
  );
}
