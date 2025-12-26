'use client';

import { loadStripe, Stripe } from '@stripe/stripe-js';

// Cache for Stripe instances per publishable key
const stripePromiseCache: Map<string, Promise<Stripe | null>> = new Map();

/**
 * Get or create a Stripe promise for a given publishable key.
 * Caches instances to avoid recreating Stripe for the same key.
 */
export function getStripePromise(publishableKey: string): Promise<Stripe | null> {
  if (!stripePromiseCache.has(publishableKey)) {
    stripePromiseCache.set(publishableKey, loadStripe(publishableKey));
  }
  return stripePromiseCache.get(publishableKey)!;
}

/**
 * Fetch the publishable key for a specific account from the API.
 * Throws an error if no key is found - no fallbacks to env variables.
 */
export async function fetchPublishableKey(accountId: string, token?: string): Promise<string> {
  let url = `/api/stripe/account-info?accountId=${encodeURIComponent(accountId)}`;
  if (token) {
    url += `&token=${encodeURIComponent(token)}`;
  }

  const res = await fetch(url);
  const data = await res.json();

  if (!data.success) {
    throw new Error(data.error || `Failed to fetch publishable key for account ${accountId}`);
  }

  if (!data.data?.publishableKey) {
    throw new Error(`No publishable key configured for account ${accountId}`);
  }

  return data.data.publishableKey;
}
