import assert from 'node:assert/strict';
import test from 'node:test';

import { createTokenRefresh } from '../src/token-refresh.js';
import { createFakeDb } from './fake-db.js';

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

function accountsFixture() {
  return [
    // Jamais revérifié depuis 48h : doit être repris.
    { id: 'stale-account', status: 'CONNECTED', updated_at: hoursAgo(48), expires_at: null },
    // Revérifié il y a 1h : ne doit pas être repris.
    { id: 'fresh-account', status: 'CONNECTED', updated_at: hoursAgo(1), expires_at: null },
    // Token qui expire réellement bientôt (cas Instagram, Sprint 07).
    { id: 'expiring-account', status: 'CONNECTED', updated_at: hoursAgo(1), expires_at: hoursFromNow(2) },
    // Déjà déconnecté : jamais repris, quel que soit expires_at/updated_at.
    { id: 'disconnected-account', status: 'DISCONNECTED', updated_at: hoursAgo(999), expires_at: null },
  ];
}

test('reprend les comptes jamais revérifiés récemment ou dont le token expire bientôt', async () => {
  const db = createFakeDb({ socialAccounts: accountsFixture() });
  const attempted = [];
  const { run } = createTokenRefresh({
    query: db.query,
    refreshToken: async (id) => attempted.push(id),
  });

  const result = await run({ expiringWithinHours: 24, staleAfterHours: 24, limit: 50 });

  assert.deepEqual(result, { inspected: 2, refreshed: 2, failed: 0 });
  assert.deepEqual(attempted.sort(), ['expiring-account', 'stale-account']);
});

test('un compte en échec de rafraîchissement n’interrompt pas les suivants', async () => {
  const db = createFakeDb({
    socialAccounts: [
      { id: 'will-fail', status: 'CONNECTED', updated_at: hoursAgo(48), expires_at: null },
      { id: 'will-succeed', status: 'CONNECTED', updated_at: hoursAgo(50), expires_at: null },
    ],
  });
  const { run } = createTokenRefresh({
    query: db.query,
    refreshToken: async (id) => {
      if (id === 'will-fail') throw new Error('REAUTHENTICATION_REQUIRED');
    },
    logger: { warn() {} },
  });

  const result = await run({ staleAfterHours: 24 });

  assert.deepEqual(result, { inspected: 2, refreshed: 1, failed: 1 });
});

test('un compte déconnecté n’est jamais repris, même avec des seuils très larges', async () => {
  const db = createFakeDb({ socialAccounts: accountsFixture() });
  const attempted = [];
  const { run } = createTokenRefresh({
    query: db.query,
    refreshToken: async (id) => attempted.push(id),
  });

  // Des seuils extrêmes reprendraient tous les comptes CONNECTED/EXPIRING —
  // le statut DISCONNECTED doit rester le seul filtre qui compte ici.
  await run({ staleAfterHours: 0.0001, expiringWithinHours: 999 });

  assert.equal(attempted.includes('disconnected-account'), false);
  assert.equal(attempted.length, 3);
});

// Sprint 11 Jour 3 — la dégradation réelle est posée côté graph-api
// (serveur), le worker la détecte en relisant le statut après la tentative ;
// le mock ci-dessous simule ce que graph-api ferait pour un échec réel.
test('une dégradation de statut notifie le connecteur du compte', async () => {
  const db = createFakeDb({
    socialAccounts: [
      {
        id: 'acc-1',
        status: 'CONNECTED',
        updated_at: hoursAgo(48),
        expires_at: null,
        brand_id: 'brand-1',
        connected_by_user_id: 'user-1',
        provider: 'INSTAGRAM',
        name: '@studio.vega',
      },
    ],
  });
  const notified = [];
  const { run } = createTokenRefresh({
    query: db.query,
    refreshToken: async (id) => {
      // Simule graph-api posant EXPIRED côté serveur avant de rejeter.
      db.state.socialAccounts.find((row) => row.id === id).status = 'EXPIRED';
      throw new Error('REAUTHENTICATION_REQUIRED');
    },
    notifyUser: async (payload) => notified.push(payload),
    logger: { warn() {} },
  });

  await run({ staleAfterHours: 24 });

  assert.equal(notified.length, 1);
  assert.deepEqual(notified[0], {
    userId: 'user-1',
    brandId: 'brand-1',
    type: 'TOKEN_EXPIRED',
    priority: 'HIGH',
    title: 'Connexion expirée',
    message: 'Reconnectez @studio.vega pour reprendre les envois sur Instagram.',
    network: 'INSTAGRAM',
    resourceType: 'SOCIAL_ACCOUNT',
    resourceId: 'acc-1',
    eventId: 'social-account:acc-1:EXPIRED',
  });
});

test('un statut inchangé ne notifie pas (pas de dégradation)', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'acc-1', status: 'CONNECTED', updated_at: hoursAgo(48), expires_at: null }],
  });
  const notified = [];
  const { run } = createTokenRefresh({
    query: db.query,
    refreshToken: async () => {},
    notifyUser: async (payload) => notified.push(payload),
  });

  await run({ staleAfterHours: 24 });

  assert.equal(notified.length, 0);
});

test('un compte révoqué notifie account_disconnected', async () => {
  const db = createFakeDb({
    socialAccounts: [
      { id: 'acc-1', status: 'EXPIRING', updated_at: hoursAgo(48), expires_at: null, provider: 'FACEBOOK' },
    ],
  });
  const notified = [];
  const { run } = createTokenRefresh({
    query: db.query,
    refreshToken: async (id) => {
      db.state.socialAccounts.find((row) => row.id === id).status = 'REVOKED';
      throw new Error('revoked');
    },
    notifyUser: async (payload) => notified.push(payload),
    logger: { warn() {} },
  });

  await run({ expiringWithinHours: 999 });

  assert.equal(notified.length, 1);
  assert.equal(notified[0].type, 'ACCOUNT_DISCONNECTED');
});

// Un échec de notification (Express/Firebase indisponible) ne doit pas faire
// régresser le résultat du rafraîchissement lui-même.
test('un échec de notification n’affecte pas le résultat du rafraîchissement', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'acc-1', status: 'CONNECTED', updated_at: hoursAgo(48), expires_at: null }],
  });
  const { run } = createTokenRefresh({
    query: db.query,
    refreshToken: async (id) => {
      db.state.socialAccounts.find((row) => row.id === id).status = 'EXPIRED';
    },
    notifyUser: async () => {
      throw new Error('api_unavailable');
    },
    logger: { warn() {} },
  });

  const result = await run({ staleAfterHours: 24 });

  assert.deepEqual(result, { inspected: 1, refreshed: 1, failed: 0 });
});
