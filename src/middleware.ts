import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Note: We can't import from @/lib/auth in middleware because the Edge runtime
// has limited crypto support. We re-implement verification here using Web Crypto.

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

// ─── GAM (central issuer) config ──────────────────────────────────────────────
// Additive: GAM-issued RS256 tokens arrive via the `gam_session` cookie and are
// verified against keys fetched from GAM's JWKS endpoint. The legacy HMAC
// `?token=` path below is unchanged.
const GAM_COOKIE = 'gam_session';
const GAM_AUDIENCE = 'stripe-dashboard';
const GAM_BASE_URL = process.env.GAM_BASE_URL || '';

interface TokenPayload {
  customerId: string;
  invoiceUID: string;
  exp: number;
  iat: number;
  kind?: 'dashboard' | 'payment_link';
  accountId?: string;
  amount?: number;
}

interface GamClaims {
  email: string;
  aud: string;
  typ: string;
  exp: number;
  iat: number;
  data?: {
    customerId?: string;
    invoiceUID?: string;
    accountId?: string;
  };
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
 * Verify and decode legacy HMAC token (unchanged)
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

// ─── GAM RS256 verification (Web Crypto, Edge compatible) ─────────────────────

function base64UrlToString(s: string): string {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  return atob(base64 + padding);
}

function base64UrlToBytes(s: string) {
  const str = base64UrlToString(s);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

// ─── JWKS cache (kid → imported CryptoKey) ────────────────────────────────────
// GAM exposes its public keys at /.well-known/jwks.json with a stable RFC-7638
// `kid` per key. We import each on first miss and cache by kid in memory.
// Key rotation: when GAM signs with a new kid we don't have, we refetch.

interface RsaJwk {
  kty: string;
  kid: string;
  alg?: string;
  n: string;
  e: string;
}

const jwksKeys = new Map<string, CryptoKey>();
let jwksInflight: Promise<void> | null = null;

async function refreshJwks(): Promise<void> {
  if (!GAM_BASE_URL) {
    console.error('GAM_BASE_URL not configured — cannot fetch JWKS');
    return;
  }
  try {
    const res = await fetch(`${GAM_BASE_URL}/.well-known/jwks.json`);
    if (!res.ok) {
      console.error(`JWKS fetch failed: ${res.status}`);
      return;
    }
    const body = (await res.json()) as { keys?: RsaJwk[] };
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || !jwk.kid) continue;
      try {
        const key = await crypto.subtle.importKey(
          'jwk',
          { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256' },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify']
        );
        jwksKeys.set(jwk.kid, key);
      } catch (e) {
        console.error(`Failed to import JWK kid=${jwk.kid}`, e);
      }
    }
  } catch (e) {
    console.error('JWKS fetch error', e);
  }
}

async function getJwksKey(kid: string): Promise<CryptoKey | null> {
  const cached = jwksKeys.get(kid);
  if (cached) return cached;
  if (!jwksInflight) {
    jwksInflight = refreshJwks().finally(() => { jwksInflight = null; });
  }
  await jwksInflight;
  return jwksKeys.get(kid) ?? null;
}

/**
 * Verify a GAM RS256 access token using the JWKS-fetched signing key.
 * Checks signature, aud, typ=access, exp. Returns claims or null.
 */
async function verifyGamToken(token: string): Promise<GamClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;

    const header = JSON.parse(base64UrlToString(headerB64));
    if (header.alg !== 'RS256' || !header.kid) return null;

    const key = await getJwksKey(header.kid);
    if (!key) return null;

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(signatureB64),
      data
    );
    if (!ok) return null;

    const claims: GamClaims = JSON.parse(base64UrlToString(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp < now) return null;
    if (claims.aud !== GAM_AUDIENCE) return null;
    if (claims.typ !== 'access') return null;

    return claims;
  } catch {
    return null;
  }
}

/**
 * Exchange a short GAM code for the full access token (server-to-server).
 */
async function exchangeGamCode(code: string): Promise<{ token: string; claims: GamClaims } | null> {
  if (!GAM_BASE_URL) {
    console.error('GAM_BASE_URL not configured — cannot exchange GAM code');
    return null;
  }
  try {
    const res = await fetch(`${GAM_BASE_URL}/auth/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name: GAM_AUDIENCE }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.success || !body?.token) return null;
    const claims = await verifyGamToken(body.token);
    if (!claims) return null;
    return { token: body.token, claims };
  } catch (e) {
    console.error('GAM exchange request failed', e);
    return null;
  }
}

function redirectExpired(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = '/expired';
  url.search = '';
  return NextResponse.redirect(url);
}

function unauthorized() {
  return new NextResponse(JSON.stringify({ success: false, error: 'Session expired' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
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
  if (pathname === '/api/stripe/pay-link/button' || pathname === '/api/stripe/pay-link/amount') {
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

    const reject = () => (isApi ? unauthorized() : redirectExpired(request));

    // GAM authorization-code landing (dashboard page only). Exchange the short
    // code for the access token, store it in an httpOnly cookie, and redirect to
    // a clean URL — the page will fetch its business context from /api/auth/me.
    const code = request.nextUrl.searchParams.get('code');
    if (code && pathname === '/') {
      const exchanged = await exchangeGamCode(code);
      if (!exchanged) {
        return redirectExpired(request);
      }
      const url = request.nextUrl.clone();
      url.search = '';

      const response = NextResponse.redirect(url);
      const now = Math.floor(Date.now() / 1000);
      response.cookies.set(GAM_COOKIE, exchanged.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: Math.max(0, exchanged.claims.exp - now),
      });
      return response;
    }

    // Resolve auth from the legacy URL token (HMAC) OR — for the dashboard
    // surface only — the GAM session cookie (RS256).
    const urlToken = request.nextUrl.searchParams.get('token');
    const cookieToken = request.cookies.get(GAM_COOKIE)?.value;

    let customerId: string | null = null;
    let invoiceUID: string | null = null;
    let accountId: string | undefined;
    let amount: number | undefined;
    let isCookieAuth = false;

    if (urlToken) {
      // ── Legacy HMAC path ──
      const secret = process.env.AUTH_SECRET;
      if (!secret) {
        console.error('AUTH_SECRET not configured');
        return new NextResponse('Server configuration error', { status: 500 });
      }
      const payload = await verifyToken(urlToken, secret);
      if (payload) {
        // Enforce kind-per-route. payment_link tokens only on pay-link routes;
        // dashboard tokens only on dashboard routes.
        const isPaymentLinkToken = payload.kind === 'payment_link';
        if (isPayLinkRoute !== isPaymentLinkToken) {
          return reject();
        }
        customerId = payload.customerId;
        invoiceUID = payload.invoiceUID;
        accountId = payload.accountId;
        amount = payload.amount;
      }
    } else if (cookieToken && isDashboardRoute) {
      // ── New GAM cookie path (dashboard only) ──
      const claims = await verifyGamToken(cookieToken);
      if (claims) {
        customerId = claims.data?.customerId ?? null;
        invoiceUID = claims.data?.invoiceUID ?? null;
        isCookieAuth = true;
      }
    }

    if (!customerId || !invoiceUID) {
      // No / invalid credentials — redirect to expired (page) or 401 (API)
      return reject();
    }

    // Credentials valid - pass the decoded values in headers for the page/API.
    if (isApi) {
      const response = NextResponse.next();
      response.headers.set('x-customer-id', customerId);
      response.headers.set('x-invoice-uid', invoiceUID);
      // pay-link routes additionally trust the signed amount/account from the
      // token, never the request body. Surface them as headers for the Node route.
      if (isPayLinkRoute) {
        if (accountId) response.headers.set('x-account-id', accountId);
        if (typeof amount === 'number') response.headers.set('x-amount', String(amount));
      }
      return response;
    }

    // Page requests. For the GAM cookie path keep the URL clean — the page reads
    // its business context from /api/auth/me. For the legacy URL-token path,
    // surface customerId/invoiceUID the way the page has always expected.
    if (!isCookieAuth) {
      const hasCustomerId = request.nextUrl.searchParams.has('customerId');
      const hasInvoiceUID = request.nextUrl.searchParams.has('invoiceUID');
      if (!hasCustomerId || !hasInvoiceUID) {
        const url = request.nextUrl.clone();
        url.searchParams.set('customerId', customerId);
        url.searchParams.set('invoiceUID', invoiceUID);
        return NextResponse.redirect(url);
      }
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
