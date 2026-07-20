import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Singleton Firestore client. Reuses the same GOOGLE_SERVICE_ACCOUNT_KEY that
// the Gmail send flow uses. On Firebase App Hosting the compute service account
// has datastore.user, so credentials may also be picked up from ADC; we prefer
// the explicit service account key when present for parity with local dev.

let firestore: Firestore | null = null;

function getApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    const credentials = JSON.parse(serviceAccountKey);
    return initializeApp({
      credential: cert(credentials),
      projectId: credentials.project_id,
    });
  }

  // Fall back to Application Default Credentials (e.g. on GCP runtime)
  return initializeApp();
}

export function getDb(): Firestore {
  if (!firestore) {
    firestore = getFirestore(getApp());
  }
  return firestore;
}

// Bucket holding Magic's uploaded record files (ScreenShotFile GUIDs). Lives in the
// lecfl-59ccf project; our SA was granted objectViewer on it. Signing is done locally
// with the service-account private key (no IAM signer role needed).
const RECORDS_BUCKET = 'lec-records';

/**
 * Generate a short-lived read URL for a file in the lec-records bucket by its exact
 * name (e.g. a ScreenShotFile GUID). Returns null if the file doesn't exist.
 */
export async function getRecordsSignedUrl(
  fileName: string,
  expiresMs = 5 * 60 * 1000
): Promise<string | null> {
  const file = getStorage(getApp()).bucket(RECORDS_BUCKET).file(fileName);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [url] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresMs,
  });
  return url;
}
