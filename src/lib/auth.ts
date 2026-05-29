import { createHmac, timingSafeEqual } from 'crypto';

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
  // For FIXED payment_link tokens: the exact amount (cents) the customer may pay,
  // read server-side, never from the body. Absent on dynamic links.
  amount?: number;
  // DYNAMIC payment_link: when true the chargeable amount is NOT fixed in the token.
  // The server computes the live outstanding balance for (customerId, invoiceUID)
  // from Stripe on each visit, and the customer may pay any amount up to it. The link
  // stays usable (within its 7-day expiry) until the balance reaches zero.
  dynamic?: boolean;
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
 * Verify HMAC signature using a constant-time comparison to avoid leaking
 * the expected signature byte-by-byte via a timing side channel.
 */
function verifySignature(data: string, signature: string): boolean {
  const expected = createSignature(data);
  // Reject obviously malformed/empty signatures up front.
  if (!signature || signature.length !== expected.length) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // Lengths are equal here, but guard anyway (timingSafeEqual throws otherwise).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Check whether any client-supplied forwarding header presents a whitelisted IP.
 *
 * SECURITY NOTE: x-forwarded-for is partly client-controlled — a caller can prepend
 * a spoofed value. We therefore require that EVERY hop in the chain (after stripping
 * the platform's own infra hops) is itself whitelisted, rather than trusting only the
 * leftmost entry. Since the real trusted servers (Magic SQL) are the only sources that
 * should ever appear, a spoofed extra hop introduces a non-whitelisted IP and fails the
 * check. This keeps the existing trusted servers working while blocking simple spoofs.
 */
export function isClientChainAllowed(request: Request): boolean {
  const xff = request.headers.get('x-forwarded-for');

  // On Firebase App Hosting / Cloud Run, the Google Front End rewrites the LEFTMOST
  // x-forwarded-for entry to the real connecting peer (a client-supplied XFF can't
  // overwrite it — GFE prepends the true source). So the trustworthy "client IP" is
  // XFF[0]. We additionally require that EVERY hop to the right of it is platform
  // infra (Google ranges / private), so an attacker can't smuggle a non-Google
  // public hop. This keeps the legitimate chain
  //   [whitelisted_server, 35.x google egress, 192.178.x GFE]
  // working while rejecting arbitrary public IPs.
  if (xff) {
    const hops = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length === 0) return false;
    const origin = hops[0];
    if (!isAllowedIP(origin)) return false;
    // Every subsequent hop must be Google/infra (not an attacker-inserted public IP).
    return hops.slice(1).every(ip => isInfraHop(ip));
  }

  // No XFF (e.g. direct/localhost in dev): fall back to other proxy headers.
  for (const h of ['x-real-ip', 'x-vercel-forwarded-for', 'cf-connecting-ip']) {
    const v = request.headers.get(h);
    if (v && isAllowedIP(v.trim())) return true;
  }
  return false;
}

// Google ranges that legitimately appear as hops AFTER the real client in the
// forwarding chain on App Hosting / Cloud Run. These are tolerated as infra, never
// trusted as the client IP (the client is XFF[0], checked against the whitelist).
// Covers Google's broad egress/GFE space (34./35./130.211./192.178./192.158./
// 66.249.) plus link-local and RFC1918. A non-Google public hop is rejected.
function isInfraHop(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/, '');
  // Google egress/GFE (34., 35., 130.211., 192.178., 192.158., 66.249.) + link-local
  // + RFC1918. Safe because the CLIENT identity is XFF[0] (whitelisted); these only
  // appear to the right of it as Google-added hops.
  return /^(34\.|35\.|130\.211\.|192\.178\.|192\.158\.|66\.249\.|169\.254\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(clean);
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
 * Generate a DYNAMIC payment-link token. No amount is signed; the server computes
 * the live outstanding balance for (customerId, invoiceUID) on each visit and lets
 * the customer pay up to it. Usable (within 7-day expiry) until the balance is zero.
 */
export function generateDynamicPaymentLinkToken(
  customerId: string,
  invoiceUID: string,
  accountId: string,
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
    dynamic: true,
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
 * Verify a token's SIGNATURE but tolerate expiry, reporting it via `expired`.
 * Used ONLY by the email button-image endpoint, which must render a grey
 * "Link Expired" button for a validly-signed-but-expired token (vs. a forged one,
 * which returns null). Never use this for authorization — a forged token still
 * returns null, but an expired one returns a payload, so callers MUST check
 * `expired` and never grant access on an expired token.
 */
export function verifyTokenAllowExpired(
  token: string
): { payload: TokenPayload; expired: boolean } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    if (!verifySignature(encodedPayload, signature)) return null;

    const payload: TokenPayload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf-8')
    );
    if (!payload.customerId || !payload.invoiceUID || !payload.accountId) return null;

    const now = Math.floor(Date.now() / 1000);
    return { payload, expired: payload.exp < now };
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
