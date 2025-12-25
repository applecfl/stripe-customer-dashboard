import Stripe from 'stripe';

// Type for Stripe account configuration
interface StripeAccountConfig {
  name: string;
  id: string;
  key: string;
  logo?: string;
  publishableKey?: string;
}

// Type for the STRIPE_LIST environment variable
type StripeList = Record<string, StripeAccountConfig>;

// Cache for Stripe instances per account
const stripeInstances: Map<string, Stripe> = new Map();

// Parse STRIPE_LIST from environment variable
function getStripeList(): StripeList {
  const stripeListStr = process.env.STRIPE_LIST;
  if (!stripeListStr) {
    throw new Error('STRIPE_LIST is not set in environment variables');
  }
  try {
    return JSON.parse(stripeListStr) as StripeList;
  } catch {
    throw new Error('STRIPE_LIST is not valid JSON');
  }
}

// Get Stripe instance for a specific account ID
export function getStripeForAccount(accountId: string): Stripe {
  // Check cache first
  const cached = stripeInstances.get(accountId);
  if (cached) {
    return cached;
  }

  const stripeList = getStripeList();
  const accountConfig = stripeList[accountId];

  if (!accountConfig) {
    throw new Error(`Stripe account not found for ID: ${accountId}`);
  }

  if (!accountConfig.key) {
    throw new Error(`Stripe key not configured for account: ${accountId}`);
  }

  const instance = new Stripe(accountConfig.key, {
    apiVersion: '2025-11-17.clover',
    typescript: true,
  });

  // Cache the instance
  stripeInstances.set(accountId, instance);

  return instance;
}

// Get account info (name, id, logo, publishableKey) without exposing the secret key
export function getStripeAccountInfo(accountId: string): { name: string; id: string; logo?: string; publishableKey?: string } | null {
  try {
    const stripeList = getStripeList();
    const accountConfig = stripeList[accountId];
    if (!accountConfig) return null;
    return {
      name: accountConfig.name,
      id: accountConfig.id,
      logo: accountConfig.logo,
      publishableKey: accountConfig.publishableKey,
    };
  } catch {
    return null;
  }
}

// Get all available account IDs
export function getAvailableAccountIds(): string[] {
  try {
    const stripeList = getStripeList();
    return Object.keys(stripeList);
  } catch {
    return [];
  }
}

// Legacy support: Get default Stripe instance (first account or STRIPE_SECRET_KEY fallback)
let defaultStripeInstance: Stripe | null = null;

function getDefaultStripe(): Stripe {
  if (!defaultStripeInstance) {
    // Try STRIPE_LIST first
    try {
      const stripeList = getStripeList();
      const firstAccountId = Object.keys(stripeList)[0];
      if (firstAccountId) {
        defaultStripeInstance = getStripeForAccount(firstAccountId);
        return defaultStripeInstance;
      }
    } catch {
      // Fall back to STRIPE_SECRET_KEY
    }

    // Fallback to legacy STRIPE_SECRET_KEY
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('Neither STRIPE_LIST nor STRIPE_SECRET_KEY is set in environment variables');
    }
    defaultStripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-11-17.clover',
      typescript: true,
    });
  }
  return defaultStripeInstance;
}

// Export a proxy that lazily initializes default Stripe on first access (for backward compatibility)
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    return getDefaultStripe()[prop as keyof Stripe];
  },
});

export default stripe;
