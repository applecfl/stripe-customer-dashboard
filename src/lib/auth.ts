import { createHmac } from 'crypto';

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
  "::1", // localhost IPv6
  "127.0.0.1", // localhost IPv4
];

// Token expiry time in seconds (30 minutes)
const TOKEN_EXPIRY_SECONDS = 30 * 60;

// Extended customer info from external system
export interface ExtendedCustomerInfo {
  fatherName?: string;
  fatherEmail?: string;
  fatherCell?: string;
  motherName?: string;
  motherEmail?: string;
  motherCell?: string;
}

// Other payments (Zelle, Cash, etc.) from external system
export interface OtherPayment {
  paymentDate: string;
  amount: number;
  paymentType: string;
  description: string;
}

export interface TokenPayload {
  customerId: string;
  invoiceUID: string;
  accountId: string;
  exp: number; // Expiration timestamp (seconds)
  iat: number; // Issued at timestamp (seconds)
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

  return ALLOWED_IPS.includes(cleanIP) || ALLOWED_IPS.includes(ip);
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
