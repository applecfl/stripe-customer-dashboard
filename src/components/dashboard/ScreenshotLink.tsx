'use client';

import { useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';

// Shows a "View screenshot" link when a payment/invoice carries a ScreenShotFile
// (a GUID in Magic's lec-records bucket). On click it fetches a short-lived signed
// URL from our API and opens it in a new tab.
export function ScreenshotLink({
  screenShotFile,
  token,
  className = '',
}: {
  screenShotFile?: string | null;
  token?: string;
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!screenShotFile) return null;

  const open = async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ file: screenShotFile });
      // Prefer the passed token; otherwise fall back to the token in the page URL
      // (the dashboard keeps ?token=... in the address for API calls).
      const urlToken = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('token')
        : null;
      const t = token || urlToken;
      if (t) qs.set('token', t);
      const res = await fetch(`/api/stripe/screenshot?${qs.toString()}`);
      const result = await res.json();
      if (!result.success || !result.data?.url) {
        throw new Error(result.error || 'Could not load screenshot');
      }
      window.open(result.data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load screenshot');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      title={error || 'View the uploaded screenshot'}
      className={`inline-flex items-center justify-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors disabled:opacity-60 ${className}`}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
      <span className="hidden sm:inline">{error ? 'Retry' : 'Screenshot'}</span>
    </button>
  );
}
