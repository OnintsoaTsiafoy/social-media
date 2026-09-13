/**
 * Firebase Admin SDK (Sprint 11) — canal de livraison push uniquement.
 *
 * Les credentials ne sont JAMAIS committées : elles viennent des trois
 * variables d'environnement extraites de la clé de compte de service
 * téléchargée depuis la console Firebase (`project_id`, `client_email`,
 * `private_key`). Comme `lib/storage.js` pour MinIO/S3, l'app n'est
 * initialisée qu'à la demande et seulement si tout est présent — son
 * absence ne doit jamais empêcher le reste de l'API de démarrer, puisque
 * REST + base restent la source de vérité (voir NotificationPushService).
 */

import admin from 'firebase-admin';

const APP_NAME = 'hootly-fcm';

export function firebaseConfig() {
  return {
    projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
    // Les gestionnaires de secrets et les fichiers .env stockent souvent les
    // retours à la ligne échappés (`\n` littéral sur une seule ligne) : sans
    // ce remplacement, la clé PEM est invalide et l'initialisation échoue.
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.trim().replace(/\\n/g, '\n'),
  };
}

export function isFirebaseConfigured() {
  const config = firebaseConfig();
  return Boolean(config.projectId && config.clientEmail && config.privateKey);
}

let app;

/** Ne throw que si appelée sans avoir vérifié `isFirebaseConfigured()`
 * d'abord — un bug interne, jamais un cas que le client final doit voir
 * (voir notifications/push.js, seul appelant). */
export function getFirebaseApp() {
  if (app) return app;
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase Cloud Messaging is not configured.');
  }
  app = admin.initializeApp({ credential: admin.credential.cert(firebaseConfig()) }, APP_NAME);
  return app;
}

/** Réinitialise l'app mémorisée ; utilisé par les tests. */
export async function resetFirebaseApp() {
  if (!app) return;
  const current = app;
  app = undefined;
  await current.delete().catch(() => {});
}
