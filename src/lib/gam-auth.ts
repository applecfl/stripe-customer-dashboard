import { createVerify, createPublicKey, type KeyObject } from 'crypto';
import type { ExtendedCustomerInfo, OtherPayment } from './auth';

/**
 * Verifier for tokens minted by the central GAM issuer (RS256).
 *
 * This is ADDITIVE — it runs alongside the legacy HMAC tokens in ./auth.ts and
 * does not touch them. GAM signs with its private key; here we only verify
 * using public keys fetched from GAM's JWKS endpoint. We hold no signing key
 * and cannot mint tokens.
 *
 * The dashboard's business context (customerId/invoiceUID/accountId/...) is baked
 * by Magic into the token's `Data` claim at /auth/issue time, so a verified GAM
 * token yields the same fields the legacy token carried.
 */

// This app's audience — GAM tokens must be minted for exactly this name.
export const GAM_AUDIENCE = 'stripe-dashboard';

export interface GamTokenData {
  customerId?: string;
  invoiceUID?: string;
  accountId?: string;
  extendedInfo?: ExtendedCustomerInfo;
  otherPayments?: OtherPayment[];
}

interface GamExtendedInfoClaim {
  FatherName?: string;
  FatherEmail?: string;
  FatherCell?: string | number;
  MotherName?: string;
  MotherEmail?: string;
  MotherCell?: string | number;
  ParentsName?: string;
  SenderName?: string;
  SenderEmail?: string;
  PaymentName?: string;
  TotalAmount?: number;
}

interface GamOtherPaymentClaim {
  PaymentDate?: string;
  Amount?: number;
  PaymentType?: string;
  Description?: string;
}

interface GamTokenDataClaim {
  CustomerID?: string;
  InvoiceUID?: string;
  AccountID?: string;
  ExtendedInfo?: GamExtendedInfoClaim;
  OtherPayments?: GamOtherPaymentClaim[];
}

export interface GamClaims {
  Sub?: string;
  Email: string;
  AUD: string;
  Typ: string;
  exp: number;
  iat: number;
  Scope?: string[];
  Data?: GamTokenDataClaim;
}

// ─── JWKS cache (kid → KeyObject) ─────────────────────────────────────────────
// Mirrors the Edge-runtime cache in middleware.ts. Two copies are required
// because middleware can't import Node `crypto`.

interface RsaJwk {
  kty: string;
  kid: string;
  alg?: string;
  n: string;
  e: string;
}

const jwksKeys = new Map<string, KeyObject>();
let jwksInflight: Promise<void> | null = null;

async function refreshJwks(): Promise<void> {
  const baseUrl = process.env.GAM_BASE_URL;
  if (!baseUrl) {
    console.error('GAM_BASE_URL not configured — cannot fetch JWKS');
    return;
  }
  try {
    const res = await fetch(`${baseUrl}/.well-known/jwks.json`);
    if (!res.ok) {
      console.error(`JWKS fetch failed: ${res.status}`);
      return;
    }
    const body = (await res.json()) as { keys?: RsaJwk[] };
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'RSA' || !jwk.kid) continue;
      try {
        const key = createPublicKey({ key: jwk as never, format: 'jwk' });
        jwksKeys.set(jwk.kid, key);
      } catch (e) {
        console.error(`Failed to import JWK kid=${jwk.kid}`, e);
      }
    }
  } catch (e) {
    console.error('JWKS fetch error', e);
  }
}

async function getJwksKey(kid: string): Promise<KeyObject | null> {
  const cached = jwksKeys.get(kid);
  if (cached) return cached;
  if (!jwksInflight) {
    jwksInflight = refreshJwks().finally(() => { jwksInflight = null; });
  }
  await jwksInflight;
  return jwksKeys.get(kid) ?? null;
}

/**
 * Verify a GAM RS256 access token. Returns the claims if valid, else null.
 * Checks: RS256 signature against the JWKS-resolved key, AUD, Typ=access, exp.
 */
export async function verifyGamToken(token: string, audience: string = GAM_AUDIENCE): Promise<GamClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null; // GAM tokens are 3-part JWTs (legacy HMAC is 2-part)
    const [headerB64, payloadB64, signatureB64] = parts;

    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf-8'));
    if (header.alg !== 'RS256' || !header.kid) return null;

    const key = await getJwksKey(header.kid);
    if (!key) return null;

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${payloadB64}`);
    verifier.end();
    if (!verifier.verify(key, Buffer.from(signatureB64, 'base64url'))) {
      return null;
    }

    const claims: GamClaims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));

    const now = Math.floor(Date.now() / 1000);
    if (!claims.exp || claims.exp < now) return null;
    if (claims.AUD !== audience) return null;
    if (claims.Typ !== 'access') return null;

    return claims;
  } catch {
    return null;
  }
}

/** Pull the dashboard business context out of a verified GAM token. */
export function gamSessionData(claims: GamClaims): GamTokenData {
  const data = claims.Data;
  if (!data) return {};

  const extended = data.ExtendedInfo;
  const extendedInfo: ExtendedCustomerInfo | undefined = extended
    ? {
        fatherName: extended.FatherName,
        fatherEmail: extended.FatherEmail,
        fatherCell: extended.FatherCell != null ? String(extended.FatherCell) : undefined,
        motherName: extended.MotherName,
        motherEmail: extended.MotherEmail,
        motherCell: extended.MotherCell != null ? String(extended.MotherCell) : undefined,
        parentsName: extended.ParentsName,
        senderName: extended.SenderName,
        senderEmail: extended.SenderEmail,
        totalAmount: extended.TotalAmount,
        paymentName: extended.PaymentName,
      }
    : undefined;

  const otherPayments: OtherPayment[] | undefined = data.OtherPayments?.map(payment => ({
    paymentDate: payment.PaymentDate ?? '',
    amount: payment.Amount ?? 0,
    paymentType: payment.PaymentType ?? '',
    description: payment.Description ?? '',
  }));

  return {
    customerId: data.CustomerID,
    invoiceUID: data.InvoiceUID,
    accountId: data.AccountID,
    extendedInfo,
    otherPayments,
  };
}
