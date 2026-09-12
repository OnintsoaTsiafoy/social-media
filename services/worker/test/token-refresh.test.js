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
