import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { verifyTokenAllowExpired, getTokenSignature } from '@/lib/auth';
import { getPaymentLink } from '@/lib/paymentLinks';

export const runtime = 'nodejs';

// Renders JUST the live balance amount as a small inline PNG, so it can sit inside
// an email sentence ("Your balance is [img].") and reflect the current outstanding
// balance each time the email is opened. Emails can't run JS, so a server-rendered
// image is the only way to show a live value in body text.
//
// Public (email clients send no auth headers); verifies the token signature and
// emits only a dollar amount — no sensitive data.

function amountImage(text: string, color: string) {
  // Width scales roughly with text length so the image hugs the number.
  const width = Math.max(70, 14 + text.length * 12);
  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          // Opaque white background so, when layered over the email's fallback text,
          // the image fully COVERS it instead of overlapping (emails render on white).
          backgroundColor: '#ffffff',
          color,
          fontSize: 18,
          fontWeight: 700,
          fontFamily: 'sans-serif',
        }}
      >
        {text}
      </div>
    ),
    {
      width,
      height: 24,
      headers: {
        // Always render the current balance — no server-side staleness. (Gmail's
        // own image proxy may still cache; that's outside our control.)
        'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
      },
    }
  );
}

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const v = token ? verifyTokenAllowExpired(token) : null;

  if (!v || v.payload.kind !== 'payment_link' || typeof v.payload.amount !== 'number') {
    return amountImage('—', '#9ca3af');
  }
  if (v.expired) {
    return amountImage('expired', '#9ca3af');
  }

  // Show the link's REMAINING counter (fall back to the signed amount if the doc
  // doesn't exist yet — don't create it here, this image is pre-fetched by email).
  let remaining = v.payload.amount;
  try {
    const rec = await getPaymentLink(getTokenSignature(token!));
    if (rec) remaining = rec.remaining;
  } catch {
    // store unreachable — show signed amount
  }
  return amountImage(remaining > 0 ? fmt(remaining) : '$0.00', '#18181b');
}
