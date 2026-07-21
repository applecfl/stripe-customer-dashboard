'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui';

// Icon-only action button that opens the payment's uploaded screenshot in a modal.
// The screenshot is a ScreenShotFile GUID stored in Magic's lec-records bucket; we
// fetch a short-lived signed URL from our API and render it inline (image or PDF).
export function ScreenshotLink({
  screenShotFile,
  token,
  className = '',
}: {
  screenShotFile?: string | null;
  token?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');

  if (!screenShotFile) return null;

  const load = async () => {
    setOpen(true);
    if (url) return; // already fetched
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ file: screenShotFile });
      const urlToken =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('token')
          : null;
      const t = token || urlToken;
      if (t) qs.set('token', t);
      const res = await fetch(`/api/stripe/screenshot?${qs.toString()}`);
      const result = await res.json();
      if (!result.success || !result.data?.url) {
        throw new Error(result.error || 'Could not load screenshot');
      }
      setUrl(result.data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load screenshot');
    } finally {
      setLoading(false);
    }
  };

  const isPdf = url.split('?')[0].toLowerCase().endsWith('.pdf');

  return (
    <>
      <button
        type="button"
        onClick={load}
        title="View uploaded screenshot"
        aria-label="View uploaded screenshot"
        className={`inline-flex items-center justify-center p-1.5 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/Authorization.png" alt="Screenshot" className="h-5 w-auto" />
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Screenshot" size="full">
        <div className="flex items-center justify-center min-h-[300px]">
          {loading ? (
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          ) : error ? (
            <div className="text-center">
              <p className="text-sm text-red-600 mb-3">{error}</p>
              <button
                type="button"
                onClick={() => { setUrl(''); load(); }}
                className="text-sm text-indigo-600 hover:text-indigo-800"
              >
                Try again
              </button>
            </div>
          ) : url ? (
            isPdf ? (
              <iframe src={url} title="Screenshot PDF" className="w-full h-[75vh] rounded-lg border-0" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="Payment screenshot" className="max-w-full max-h-[75vh] rounded-lg object-contain" />
            )
          ) : null}
        </div>
      </Modal>
    </>
  );
}
