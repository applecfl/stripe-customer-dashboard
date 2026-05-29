import { createHmac } from 'crypto';

// IPv6 prefixes to allow (matches any address starting with these)
const ALLOWED_IPV6_PREFIXES = [
  "2a01:6500:a052:1669:",
];

// Whitelisted IPs that can generate tokens (Magic SQL servers)
export const ALLOWED_IPS = [
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
  "2a01:6500:a052:1669:4cd4:a0e7:2b4d:60a2",
  "::1", // localhost IPv6
  "127.0.0.1", // localhost IPv4
];

// Token expiry time in seconds (30 minutes)
const TOKEN_EXPIRY_SECONDS = 30 * 60;

// Payment-link tokens live longer so the email has time to be read, but are
// single-use (enforced via Firestore) so a leaked link can't be replayed.
const PAYMENT_LINK_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

// Extended customer info from external system
export interface ExtendedCustomerInfo {
  fatherName?: string;
  fatherEmail?: string;
  fatherCell?: string;
  motherName?: string;
  motherEmail?: string;
  motherCell?: string;
  // Pre-formatted parent names for emails (e.g., "Mr. Boris and Mrs. Kristina Akbosh")
  parentsName?: string;
  // Email sender info (e.g., "Rabbi Sholem Kleinman", "sholem@lecfl.com")
  senderName?: string;
  senderEmail?: string;
  // Payment summary info
  totalAmount?: number;
  paymentName?: string;
}

// Other payments (Zelle, Cash, etc.) from external system
export interface OtherPayment {
  paymentDate: string;
  amount: number;
  paymentType: string;
  description: string;
}

// Token kind distinguishes the full admin dashboard token from a customer-facing
// single-use payment link. Absent/undefined kind === legacy "dashboard" token.
export type TokenKind = 'dashboard' | 'payment_link';

export interface TokenPayload {
  customerId: string;
  invoiceUID: string;
  accountId: string;
  exp: number; // Expiration timestamp (seconds)
  iat: number; // Issued at timestamp (seconds)
  // Token kind - controls which routes the token may open (see middleware)
  kind?: TokenKind;
  // For payment_link tokens: the exact amount (in cents) the customer may pay.
  // The charge amount is read from here server-side, never from the request body.
  amount?: number;
  // Extended info from external system
  extendedInfo?: ExtendedCustomerInfo;
  otherPayments?: OtherPayment[];
}

/**
 * Get the auth secret from environment
 */
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET environment variable is not set');
  }
  return secret;
}

/**
 * Create HMAC signature for data
 */
function createSignature(data: string): string {
  return createHmac('sha256', getSecret())
    .update(data)
    .digest('base64url');
}

/**
 * Verify HMAC signature
 */
function verifySignature(data: string, signature: string): boolean {
  const expectedSignature = createSignature(data);
  return expectedSignature === signature;
}

/**
 * Check if an IP address is in the whitelist
 */
export function isAllowedIP(ip: string | null): boolean {
  if (!ip) return false;

  // Handle IPv6-mapped IPv4 addresses (::ffff:192.168.1.1)
  const cleanIP = ip.replace(/^::ffff:/, '');

  // Check exact match
  if (ALLOWED_IPS.includes(cleanIP) || ALLOWED_IPS.includes(ip)) {
    return true;
  }

  // Check IPv6 prefix match
  return ALLOWED_IPV6_PREFIXES.some(prefix => cleanIP.startsWith(prefix) || ip.startsWith(prefix));
}

/**
 * Generate a signed token for the given customer, invoice, and account
 */
export function generateToken(
  customerId: string,
  invoiceUID: string,
  accountId: string,
  extendedInfo?: ExtendedCustomerInfo,
  otherPayments?: OtherPayment[]
): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TOKEN_EXPIRY_SECONDS;

  const payload: TokenPayload = {
    customerId,
    invoiceUID,
    accountId,
    exp: expiresAt,
    iat: now,
    extendedInfo,
    otherPayments,
  };

  // Encode payload as base64url
  const payloadStr = JSON.stringify(payload);
  const encodedPayload = Buffer.from(payloadStr).toString('base64url');

  // Create signature
  const signature = createSignature(encodedPayload);

  // Combine payload and signature
  const token = `${encodedPayload}.${signature}`;

  return { token, expiresAt };
}

/**
 * Generate a single-use payment-link token for a customer-facing pay page.
 * The amount (cents) is signed into the token; the server charges exactly this.
 * Expires in 7 days; single-use is enforced separately via Firestore.
 */
export function generatePaymentLinkToken(
  customerId: string,
  invoiceUID: string,
  accountId: string,
  amount: number,
  extendedInfo?: ExtendedCustomerInfo
): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + PAYMENT_LINK_EXPIRY_SECONDS;

  const payload: TokenPayload = {
    customerId,
    invoiceUID,
    accountId,
    exp: expiresAt,
    iat: now,
    kind: 'payment_link',
    amount,
    extendedInfo,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createSignature(encodedPayload);
  const token = `${encodedPayload}.${signature}`;

  return { token, expiresAt };
}

/**
 * Derive the stable single-use key for a payment-link token. We use the token's
 * signature segment (already an HMAC over the payload) rather than the raw token,
 * so the Firestore doc id is fixed-length and contains no payload data.
 */
export function getTokenSignature(token: string): string {
  const parts = token.split('.');
  return parts[1] || '';
}

/**
 * Verify and decode a token
 * Returns the payload if valid, null if invalid or expired
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    // Split token into payload and signature
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [encodedPayload, signature] = parts;

    // Verify signature
    if (!verifySignature(encodedPayload, signature)) {
      return null;
    }

    // Decode payload
    const payloadStr = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
    const payload: TokenPayload = JSON.parse(payloadStr);

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }

    // Validate required fields
    if (!payload.customerId || !payload.invoiceUID || !payload.accountId) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract client IP from request headers
 * Handles various proxy headers
 */
export function getClientIP(request: Request): string | null {
  // Check various headers that might contain the real IP
  const headers = request.headers;

  // X-Forwarded-For can contain multiple IPs, take the first one
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    return ips[0] || null;
  }

  // Other common proxy headers
  const realIP = headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }

  // Vercel-specific header
  const vercelForwardedFor = headers.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) {
    return vercelForwardedFor;
  }

  // CF-Connecting-IP for Cloudflare
  const cfConnectingIP = headers.get('cf-connecting-ip');
  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  return null;
}
