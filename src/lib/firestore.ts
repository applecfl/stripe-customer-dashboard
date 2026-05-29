import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

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
