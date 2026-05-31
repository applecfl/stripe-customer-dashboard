import { NextRequest, NextResponse } from 'next/server';
import { verifyGamToken, gamSessionData } from '@/lib/gam-auth';

/**
 * Session endpoint for the GAM cookie flow.
 *
 * In cookie mode the access token lives in the httpOnly `gam_session` cookie and
 * is NOT in the URL, so the client can't decode it. This returns the verified
 * business context (customer/invoice/account + extended info) so the page can
 * render. Not used by the legacy URL-token flow.
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get('gam_session')?.value;
  if (!token) {
    return NextResponse.json({ success: false, error: 'No session' }, { status: 401 });
  }

  const claims = await verifyGamToken(token);
  if (!claims) {
    return NextResponse.json({ success: false, error: 'Invalid or expired session' }, { status: 401 });
  }

  const data = gamSessionData(claims);
  return NextResponse.json({
    success: true,
    email: claims.email,
    customerId: data.customerId ?? null,
    invoiceUID: data.invoiceUID ?? null,
    accountId: data.accountId ?? null,
    extendedInfo: data.extendedInfo ?? null,
    otherPayments: data.otherPayments ?? null,
    expiresAt: claims.exp,
  });
}
