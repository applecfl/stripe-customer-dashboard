'use client';

import { useState } from 'react';
import { Loader2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Modal } from '@/components/ui';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

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
  const [zoom, setZoom] = useState(1);

  if (!screenShotFile) return null;

  const close = () => { setOpen(false); setZoom(1); };
  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));
  const resetZoom = () => setZoom(1);

  const load = async () => {
    setOpen(true);
    setZoom(1);
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

      <Modal isOpen={open} onClose={close} title="Screenshot" size="full">
        {/* Zoom toolbar — only for images (PDFs use the browser's own controls) */}
        {url && !isPdf && !loading && !error && (
          <div className="flex items-center justify-center gap-2 mb-3">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              title="Zoom out"
              className="inline-flex items-center justify-center p-1.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-40"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-500 w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              title="Zoom in"
              className="inline-flex items-center justify-center p-1.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-40"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={resetZoom}
              title="Reset zoom"
              className="inline-flex items-center justify-center p-1.5 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-center min-h-[300px] max-h-[78vh] overflow-auto">
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
              <img
                src={url}
                alt="Payment screenshot"
                style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
                className="max-w-full max-h-[75vh] rounded-lg object-contain transition-transform duration-150"
              />
            )
          ) : null}
        </div>
      </Modal>
    </>
  );
}
