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

function button(label: string, color: string) {
  // The pill fills the ENTIRE image frame (edge to edge) so, when layered over the
  // email's fallback text button, it fully COVERS it instead of letting the text
  // bleed around a transparent margin.
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: color,
          color: '#ffffff',
          fontSize: 22,
          fontWeight: 600,
          borderRadius: 10,
          fontFamily: 'sans-serif',
        }}
      >
        {label}
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: {
        // Always render the current balance — no server-side staleness. (Gmail's
        // own image proxy may still cache; that's outside our control.)
        'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
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
    return button('Link Expired', '#9ca3af');
  }

  const fmt = (cents: number) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  // Show the link's REMAINING counter. The doc may not exist yet if the customer
  // hasn't opened /pay (which initialises it) — fall back to the signed amount.
  // Don't create the doc here (this image is pre-fetched by email clients).
  let remaining = v.payload.amount;
  try {
    const rec = await getPaymentLink(getTokenSignature(token!));
    if (rec) remaining = rec.remaining;
  } catch {
    // Store unreachable — show the signed amount; the page/route enforce truth.
  }

  if (remaining <= 0) return button('Paid in Full', '#9ca3af');
  return button(`Pay ${fmt(remaining)} Now`, '#4f46e5');
}
