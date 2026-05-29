import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Note2: We can't import from @/lib/auth in middleware because Edge runtime
// has limited crypto support. We'll re-implement the verification here.

const ALLOWED_IPS = [
  "35.208.69.250",
  "34.56.181.246",
  "0.1.0.2",
  "50.250.116.233",
  "50.250.116.234",
  "67.23.68.218",
  "212.76.105.22",
  "109.253.161.90",
  "109.253.201.217",
  "67.23.68.219",
  "12.5.183.42",
  "12.5.183.44",
  "::1",
  "127.0.0.1",
];

interface TokenPayload {
  customerId: string;
  invoiceUID: string;
  exp: number;
  iat: number;
  kind?: 'dashboard' | 'payment_link';
  accountId?: string;
  amount?: number;
}

/**
 * Get client IP from request
 */
function getClientIP(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    return ips[0] || null;
  }

  const realIP = request.headers.get('x-real-ip');
  if (realIP) return realIP;

  const vercelForwardedFor = request.headers.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) return vercelForwardedFor;

  const cfConnectingIP = request.headers.get('cf-connecting-ip');
  if (cfConnectingIP) return cfConnectingIP;

  return null;
}

/**
 * Check if IP is allowed
 */
function isAllowedIP(ip: string | null): boolean {
  if (!ip) return false;
  const cleanIP = ip.replace(/^::ffff:/, '');
  return ALLOWED_IPS.includes(cleanIP) || ALLOWED_IPS.includes(ip);
}

/**
 * Create HMAC signature using Web Crypto API (Edge compatible)
 */
async function createSignature(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);

  // Convert to base64url
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Constant-time string comparison (Edge has no crypto.timingSafeEqual).
 * Always compares the full length to avoid an early-exit timing side channel.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verify and decode token
 */
async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [encodedPayload, signature] = parts;

    // Verify signature (constant-time, reject empty/malformed).
    const expectedSignature = await createSignature(encodedPayload, secret);
    if (!signature || !constantTimeEqual(expectedSignature, signature)) return null;

    // Decode payload (base64url to string)
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const payloadStr = atob(base64 + padding);
    const payload: TokenPayload = JSON.parse(payloadStr);

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    // Validate required fields
    if (!payload.customerId || !payload.invoiceUID) return null;

    return payload;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow token generation endpoint - it uses IP-based auth
  if (pathname === '/api/auth/generate-token') {
    return NextResponse.next();
  }

  // Allow update-uids endpoint - it uses IP-based auth
  if (pathname === '/api/stripe/payments/update-uids') {
    return NextResponse.next();
  }

  // Allow debug-key endpoint - for debugging only
  if (pathname === '/api/stripe/debug-key') {
    return NextResponse.next();
  }

  // Allow static files, _next, etc.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Allow expired page
  if (pathname === '/expired') {
    return NextResponse.next();
  }

  // Allow the payment-link button IMAGE endpoint through. It's loaded by email
  // clients (no headers) and must render even for an EXPIRED token (to show a grey
  // "Link Expired" button), so it can't go through the normal token gate. It does
  // its own verification internally and never returns sensitive data (only a PNG).
  if (pathname === '/api/stripe/pay-link/button') {
    return NextResponse.next();
  }

  // Route classification:
  //  - Customer pay-link surface: /pay page + /api/stripe/pay-link* routes.
  //    Requires a payment_link token. A dashboard token must NOT open these.
  //  - Admin/dashboard surface: / page + all other /api/stripe/* routes.
  //    Requires a dashboard (non-payment_link) token. A payment_link token must
  //    NOT open these (so a leaked pay link can't reach the full dashboard/API).
  const isPayLinkRoute = pathname === '/pay' || pathname.startsWith('/api/stripe/pay-link');
  const isDashboardRoute =
    !isPayLinkRoute && (pathname === '/' || pathname.startsWith('/api/stripe'));

  if (isPayLinkRoute || isDashboardRoute) {
    const isApi = pathname.startsWith('/api/');
    const token = request.nextUrl.searchParams.get('token');
    const secret = process.env.AUTH_SECRET;

    if (!secret) {
      console.error('AUTH_SECRET not configured');
      return new NextResponse('Server configuration error', { status: 500 });
    }

    const reject = () => {
      if (isApi) {
        return new NextResponse(JSON.stringify({ success: false, error: 'Session expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/expired';
      url.search = '';
      return NextResponse.redirect(url);
    };

    if (!token) return reject();

    const payload = await verifyToken(token, secret);
    if (!payload) return reject();

    // Enforce kind-per-route. payment_link tokens only on pay-link routes;
    // dashboard tokens only on dashboard routes.
    const isPaymentLinkToken = payload.kind === 'payment_link';
    if (isPayLinkRoute !== isPaymentLinkToken) {
      return reject();
    }

    // Token is valid and kind matches the route.
    if (isApi) {
      const response = NextResponse.next();
      response.headers.set('x-customer-id', payload.customerId);
      response.headers.set('x-invoice-uid', payload.invoiceUID);
      // pay-link routes additionally trust the signed amount/account from the token,
      // never the request body. Surface them as headers for the Node route.
      if (isPayLinkRoute) {
        if (payload.accountId) response.headers.set('x-account-id', payload.accountId);
        if (typeof payload.amount === 'number') response.headers.set('x-amount', String(payload.amount));
      }
      return response;
    }

    // Page requests: surface customerId/invoiceUID as query params (existing behavior).
    const hasCustomerId = request.nextUrl.searchParams.has('customerId');
    const hasInvoiceUID = request.nextUrl.searchParams.has('invoiceUID');
    if (!hasCustomerId || !hasInvoiceUID) {
      const url = request.nextUrl.clone();
      url.searchParams.set('customerId', payload.customerId);
      url.searchParams.set('invoiceUID', payload.invoiceUID);
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
