import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { verifyTokenAllowExpired } from '@/lib/auth';
import { getStripeForAccount } from '@/lib/stripe';
import { getOutstandingForUID } from '@/lib/balance';

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
          backgroundColor: 'transparent',
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
      headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' },
    }
  );
}

const fmt = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const v = token ? verifyTokenAllowExpired(token) : null;

  if (!v || v.payload.kind !== 'payment_link') {
    return amountImage('—', '#9ca3af');
  }
  if (v.expired) {
    return amountImage('expired', '#9ca3af');
  }

  // Dynamic: live balance. Fixed: the signed amount.
  if (v.payload.dynamic === true) {
    try {
      const stripe = getStripeForAccount(v.payload.accountId);
      const outstanding = await getOutstandingForUID(stripe, v.payload.customerId, v.payload.invoiceUID);
      return amountImage(outstanding > 0 ? fmt(outstanding) : '$0.00', '#18181b');
    } catch {
      return amountImage('—', '#9ca3af');
    }
  }

  return amountImage(typeof v.payload.amount === 'number' ? fmt(v.payload.amount) : '—', '#18181b');
}
