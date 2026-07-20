import { NextRequest, NextResponse } from 'next/server';
import { getRecordsSignedUrl } from '@/lib/firestore';

export const runtime = 'nodejs';

// Returns a short-lived signed URL for a payment/invoice's ScreenShotFile (the GUID
// stored by Magic in the lec-records bucket). Gated by the normal token middleware
// (/api/stripe/*). The `file` param is a bucket object name — restrict it to a safe
// filename charset so it can't be used for path traversal into other objects.
const SAFE_FILE = /^[A-Za-z0-9._-]{1,128}$/;

export async function GET(request: NextRequest) {
  const file = request.nextUrl.searchParams.get('file');
  if (!file || !SAFE_FILE.test(file)) {
    return NextResponse.json({ success: false, error: 'Invalid file id' }, { status: 400 });
  }
  try {
    const url = await getRecordsSignedUrl(file);
    if (!url) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }
    return NextResponse.json(
      { success: true, data: { url } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    console.error('screenshot signed-url error:', e);
    return NextResponse.json({ success: false, error: 'Could not load file' }, { status: 500 });
  }
}
