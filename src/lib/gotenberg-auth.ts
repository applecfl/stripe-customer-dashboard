// Auth header for calling the (now private) Gotenberg Cloud Run service.
//
// Gotenberg is deployed as the official image with NO public access, so callers must
// present a Google-signed OIDC ID token whose audience is the Gotenberg service URL.
// On Cloud Run / App Hosting we get one from the instance metadata server. Locally
// (no metadata server) we return no auth header — a local/dev Gotenberg is expected
// to be reachable without it.

const GOTENBERG_URL = process.env.GOTENBERG_URL || 'http://localhost:3000';

let cached: { token: string; exp: number } | null = null;

async function fetchIdToken(audience: string): Promise<string | null> {
  try {
    const url =
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=' +
      encodeURIComponent(audience);
    const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    // Not on GCP (local dev) — no metadata server.
    return null;
  }
}

/**
 * Returns the headers to attach when calling Gotenberg. On GCP this is a Bearer ID
 * token (cached ~50 min); locally it's an empty object. Safe to spread into fetch.
 */
export async function getGotenbergAuthHeader(): Promise<Record<string, string>> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp > now + 60) {
    return { Authorization: `Bearer ${cached.token}` };
  }
  const token = await fetchIdToken(GOTENBERG_URL);
  if (!token) return {};
  // Google ID tokens are valid ~1h; cache for 50 min.
  cached = { token, exp: now + 50 * 60 };
  return { Authorization: `Bearer ${token}` };
}
