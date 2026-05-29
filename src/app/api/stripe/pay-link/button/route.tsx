import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { verifyTokenAllowExpired, getTokenSignature } from '@/lib/auth';
import { getPaymentLink } from '@/lib/paymentLinks';

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
  if (!v || v.payload.kind !== 'payment_link' || typeof v.payload.amount !== 'number') {
    return button('Link Unavailable', '#9ca3af');
  }

  if (v.expired) {
    return button('Link Expired', '#9ca3af', 'This payment link is no longer active');
  }

  // Consumed (already paid) -> grey.
  try {
    const rec = await getPaymentLink(getTokenSignature(token!));
    if (rec?.status === 'paid') {
      return button('Already Paid', '#9ca3af', 'This payment has been received');
    }
  } catch {
    // If the single-use store is unreachable, fail open to the active button —
    // the /pay page and charge route still enforce single-use authoritatively.
  }

  const dollars = (v.payload.amount / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  return button(`Pay ${dollars} Now`, '#4f46e5');
}
