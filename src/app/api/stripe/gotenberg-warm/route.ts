import { NextResponse } from 'next/server';
import { getGotenbergAuthHeader } from '@/lib/gotenberg-auth';

const GOTENBERG_URL = process.env.GOTENBERG_URL || 'http://localhost:3000';

// Keep-warm endpoint hit by Cloud Scheduler during working hours. It runs a tiny
// real PDF conversion so the Gotenberg Cloud Run container (and Chromium) stay warm,
// avoiding the ~8s cold start on the first statement of an idle period. Public + fast;
// emits no sensitive data. Safe to call repeatedly.
export async function GET() {
  const started = Date.now();
  try {
    const form = new FormData();
    form.append('files', new Blob(['<html><body>warm</body></html>'], { type: 'text/html' }), 'index.html');
    const res = await fetch(`${GOTENBERG_URL}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      headers: await getGotenbergAuthHeader(),
    });
    // Drain the body so the connection completes.
    await res.arrayBuffer().catch(() => undefined);
    return NextResponse.json(
      { ok: res.ok, status: res.status, ms: Date.now() - started },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'warm failed', ms: Date.now() - started },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
