import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Note: We can't import from @/lib/auth in middleware because Edge runtime
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
 * Verify and decode token
 */
async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [encodedPayload, signature] = parts;

    // Verify signature
    const expectedSignature = await createSignature(encodedPayload, secret);
    if (expectedSignature !== signature) return null;

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

  // For main page and API routes, require token authentication
  if (pathname === '/' || pathname.startsWith('/api/stripe')) {
    const token = request.nextUrl.searchParams.get('token');
    const secret = process.env.AUTH_SECRET;

    if (!secret) {
      console.error('AUTH_SECRET not configured');
      return new NextResponse('Server configuration error', { status: 500 });
    }

    if (!token) {
      // No token - redirect to expired page (for page requests) or return 401 (for API)
      if (pathname.startsWith('/api/')) {
        return new NextResponse(JSON.stringify({ success: false, error: 'Session expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/expired';
      url.search = '';
      return NextResponse.redirect(url);
    }

    const payload = await verifyToken(token, secret);

    if (!payload) {
      // Invalid or expired token - redirect to expired page (for page requests) or return 401 (for API)
      if (pathname.startsWith('/api/')) {
        return new NextResponse(JSON.stringify({ success: false, error: 'Session expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const url = request.nextUrl.clone();
      url.pathname = '/expired';
      url.search = '';
      return NextResponse.redirect(url);
    }

    // Token is valid - pass the decoded values in headers for the page/API to use

    // For API routes, add customer info to headers
    if (pathname.startsWith('/api/stripe')) {
      const response = NextResponse.next();
      response.headers.set('x-customer-id', payload.customerId);
      response.headers.set('x-invoice-uid', payload.invoiceUID);
      return response;
    }

    // For the main page, redirect to include customerId and invoiceUID as visible query params
    // Check if customerId is already in the URL to avoid redirect loop
    const hasCustomerId = request.nextUrl.searchParams.has('customerId');
    const hasInvoiceUID = request.nextUrl.searchParams.has('invoiceUID');

    if (!hasCustomerId || !hasInvoiceUID) {
      const url = request.nextUrl.clone();
      url.searchParams.set('customerId', payload.customerId);
      url.searchParams.set('invoiceUID', payload.invoiceUID);
      // Keep the token in the URL for subsequent API calls
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
