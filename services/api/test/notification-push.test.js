import assert from 'node:assert/strict';
import test from 'node:test';

import { firebaseConfig, isFirebaseConfigured } from '../src/lib/firebase.js';
import {
  androidPriorityFor,
  apnsPriorityFor,
  buildPushPayload,
  FCM_PAYLOAD_VERSION,
  isStaleTokenErrorCode,
} from '../src/notifications/push.js';

const UUID = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';

test('firebase is reported unconfigured until all three credentials are present', () => {
  const originalProject = process.env.FIREBASE_PROJECT_ID;
  const originalEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const originalKey = process.env.FIREBASE_PRIVATE_KEY;
  try {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_CLIENT_EMAIL;
    delete process.env.FIREBASE_PRIVATE_KEY;
    assert.equal(isFirebaseConfigured(), false);

    process.env.FIREBASE_PROJECT_ID = 'hootly-demo';
    process.env.FIREBASE_CLIENT_EMAIL = 'fcm@hootly-demo.iam.gserviceaccount.com';
    assert.equal(isFirebaseConfigured(), false);

    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n';
    assert.equal(isFirebaseConfigured(), true);
  } finally {
    if (originalProject === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = originalProject;
    if (originalEmail === undefined) delete process.env.FIREBASE_CLIENT_EMAIL;
    else process.env.FIREBASE_CLIENT_EMAIL = originalEmail;
    if (originalKey === undefined) delete process.env.FIREBASE_PRIVATE_KEY;
    else process.env.FIREBASE_PRIVATE_KEY = originalKey;
  }
});

// Piège classique de firebase-admin : un .env stocke la clé sur une seule
// ligne avec des `\n` échappés, qui doivent redevenir de vrais retours à la
// ligne avant d'atteindre `credential.cert()`, sinon la clé PEM est invalide.
test('the private key literal \\n escapes are unescaped into real newlines', () => {
  const original = process.env.FIREBASE_PRIVATE_KEY;
  try {
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n';
    assert.equal(
      firebaseConfig().privateKey,
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n'
    );
  } finally {
    if (original === undefined) delete process.env.FIREBASE_PRIVATE_KEY;
    else process.env.FIREBASE_PRIVATE_KEY = original;
  }
});

test('the push payload is data-only, versioned, and never has a null/undefined field', () => {
  const payload = buildPushPayload({
    id: UUID,
    eventId: 'evt-1',
    type: 'PRIORITY_COMMENT',
    resourceType: 'COMMENT',
    resourceId: 'cmt_1',
    brandId: 'brand_1',
  });

  assert.equal(payload.version, FCM_PAYLOAD_VERSION);
  assert.equal(payload.type, 'priority_comment');
  assert.equal(payload.resourceType, 'comment');
  for (const value of Object.values(payload)) {
    assert.equal(typeof value, 'string');
  }
});

test('a notification without a resource still produces string fields, never null', () => {
  const payload = buildPushPayload({
    id: UUID,
    eventId: 'evt-2',
    type: 'AI_RESPONSE_READY',
    resourceType: null,
    resourceId: null,
    brandId: null,
  });

  assert.equal(payload.resourceType, '');
  assert.equal(payload.resourceId, '');
  assert.equal(payload.brandId, '');
});

test('high priority notifications get FCM high/APNs 10, everything else normal/5', () => {
  assert.equal(androidPriorityFor('HIGH'), 'high');
  assert.equal(androidPriorityFor('MEDIUM'), 'normal');
  assert.equal(androidPriorityFor('LOW'), 'normal');
  assert.equal(apnsPriorityFor('HIGH'), '10');
  assert.equal(apnsPriorityFor('LOW'), '5');
});

// Seuls ces deux codes signifient « ce token n'existe plus » : tout le reste
// (quota, panne serveur, argument invalide) ne doit jamais désactiver un
// appareil pour une raison purement transitoire.
test('only the two FCM "gone" error codes are treated as a stale token', () => {
  assert.equal(isStaleTokenErrorCode('messaging/registration-token-not-registered'), true);
  assert.equal(isStaleTokenErrorCode('messaging/invalid-registration-token'), true);
  assert.equal(isStaleTokenErrorCode('messaging/internal-error'), false);
  assert.equal(isStaleTokenErrorCode('messaging/quota-exceeded'), false);
  assert.equal(isStaleTokenErrorCode(undefined), false);
});
