import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { verifyTokenAllowExpired, getTokenSignature } from '@/lib/auth';
import { getPaymentLink } from '@/lib/paymentLinks';
import { getStripeForAccount } from '@/lib/stripe';
import { getOutstandingForUID } from '@/lib/balance';

export const runtime = 'nodejs';

// Renders the "Pay Now" button as a PNG so it can live in an email (emails can't
// run JS). The button reflects live state when the email is OPENED:
//   - active  -> blue  "Pay $X Now"
//   - expired -> grey  "Link Expired"   (7-day token expiry)
//   - paid    -> grey  "Already Paid"   (single-use consumed)
// Public endpoint (email clients send no auth headers); it verifies the token's
// signature itself and only ever emits a button image — no sensitive data.

const WIDTH = 320;
const HEIGHT = 64;

function button(label: string, color: string, sub?: string) {
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: 'transparent',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color,
            color: '#ffffff',
            fontSize: 22,
            fontWeight: 600,
            padding: '14px 32px',
            borderRadius: 10,
            fontFamily: 'sans-serif',
          }}
        >
          {label}
        </div>
        {sub ? (
          <div style={{ display: 'flex', marginTop: 8, fontSize: 12, color: '#a1a1aa', fontFamily: 'sans-serif' }}>
            {sub}
          </div>
        ) : null}
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT + (sub ? 28 : 0),
      headers: {
        // Don't let an email client cache an old state for long; re-fetch on open.
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  // Forged / missing token -> neutral grey, no info leak.
  const v = token ? verifyTokenAllowExpired(token) : null;
  const isDynamic = v?.payload.dynamic === true;
  // Valid payment_link required; fixed links must carry an amount.
  if (!v || v.payload.kind !== 'payment_link' || (!isDynamic && typeof v.payload.amount !== 'number')) {
    return button('Link Unavailable', '#9ca3af');
  }

  if (v.expired) {
    return button('Link Expired', '#9ca3af', 'This payment link is no longer active');
  }

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  if (isDynamic) {
    // Live balance: blue with the current outstanding amount, or grey when zero.
    try {
      const stripe = getStripeForAccount(v.payload.accountId);
      const outstanding = await getOutstandingForUID(stripe, v.payload.customerId, v.payload.invoiceUID);
      if (outstanding <= 0) {
        return button('Paid in Full', '#9ca3af', 'Your balance has been paid');
      }
      return button(`Pay ${fmt(outstanding)} Now`, '#4f46e5');
    } catch {
      // If Stripe is unreachable, show a neutral active button; the page enforces truth.
      return button('Pay Your Balance', '#4f46e5');
    }
  }

  // Fixed link: grey once consumed (single-use).
  try {
    const rec = await getPaymentLink(getTokenSignature(token!));
    if (rec?.status === 'paid') {
      return button('Already Paid', '#9ca3af', 'This payment has been received');
    }
  } catch {
    // If the single-use store is unreachable, fail open to the active button —
    // the /pay page and charge route still enforce single-use authoritatively.
  }

  return button(`Pay ${fmt(v.payload.amount!)} Now`, '#4f46e5');
}
