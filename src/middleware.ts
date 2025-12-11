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

  // Allow static files, _next, etc.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
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
      // No token - return access denied page
      return new NextResponse(
        generateErrorHTML('Authentication Required', 'Please access this page through the LEC system.'),
        {
          status: 401,
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }

    const payload = await verifyToken(token, secret);

    if (!payload) {
      // Invalid or expired token
      return new NextResponse(
        generateErrorHTML('Session Expired', 'Your session has expired. Please return to the LEC system and try again.'),
        {
          status: 401,
          headers: { 'Content-Type': 'text/html' },
        }
      );
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

/**
 * Generate error HTML page
 */
function generateErrorHTML(title: string, message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - LEC Payment Manager</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f9fafb;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border: 1px solid #e5e7eb;
      padding: 48px;
      max-width: 400px;
      text-align: center;
    }
    .icon {
      width: 64px;
      height: 64px;
      background: #fef2f2;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
    }
    .icon svg {
      width: 32px;
      height: 32px;
      color: #ef4444;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 12px;
    }
    p {
      color: #6b7280;
      line-height: 1.6;
    }
    .logo {
      margin-bottom: 24px;
    }
    .logo img {
      height: 40px;
      width: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <img src="https://lecfl.com/wp-content/uploads/2024/08/LEC-Logo-Primary-1.png" alt="LEC Logo" />
    </div>
    <div class="icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>
`;
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
