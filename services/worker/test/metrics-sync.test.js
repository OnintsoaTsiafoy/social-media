import assert from 'node:assert/strict';
import test from 'node:test';

import { createMetricsSync } from '../src/metrics-sync.js';
import { createFakeDb } from './fake-db.js';

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

test('reprend les comptes jamais synchronisés ou synchronisés il y a longtemps', async () => {
  const db = createFakeDb({
    socialAccounts: [
      { id: 'never-synced', provider: 'FACEBOOK', status: 'CONNECTED', last_metrics_sync_at: null },
      { id: 'stale', provider: 'FACEBOOK', status: 'CONNECTED', last_metrics_sync_at: minutesAgo(120) },
      { id: 'fresh', provider: 'FACEBOOK', status: 'CONNECTED', last_metrics_sync_at: minutesAgo(1) },
      { id: 'disconnected', provider: 'FACEBOOK', status: 'DISCONNECTED', last_metrics_sync_at: null },
    ],
    targets: [
      { social_account_id: 'never-synced', external_publication_id: 'post-1', status: 'SENT' },
      { social_account_id: 'stale', external_publication_id: 'post-2', status: 'SENT' },
    ],
  });
  const synced = [];
  const { run } = createMetricsSync({
    query: db.query,
    syncMetrics: async (accountId, provider, ids) => synced.push({ accountId, provider, ids }),
  });

  const result = await run({ staleAfterMinutes: 60, accountLimit: 20 });

  assert.deepEqual(result, { inspected: 2, synced: 2, skipped: 0, failed: 0 });
  assert.deepEqual(synced.map((entry) => entry.accountId).sort(), ['never-synced', 'stale']);
});

test('un compte sans post envoyé est ignoré sans appeler graph-api', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'nothing-sent', provider: 'FACEBOOK', status: 'CONNECTED', last_metrics_sync_at: null }],
    targets: [{ social_account_id: 'nothing-sent', external_publication_id: 'post-1', status: 'PENDING' }],
  });
  let calls = 0;
  const { run } = createMetricsSync({
    query: db.query,
    syncMetrics: async () => {
      calls += 1;
    },
  });

  const result = await run({ staleAfterMinutes: 60 });

  assert.deepEqual(result, { inspected: 1, synced: 0, skipped: 1, failed: 0 });
  assert.equal(calls, 0);
});

test('la liste de cibles par compte est plafonnée à targetsPerAccount', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'many-posts', provider: 'FACEBOOK', status: 'CONNECTED', last_metrics_sync_at: null }],
    targets: [
      { social_account_id: 'many-posts', external_publication_id: 'post-1', status: 'SENT', sent_at: minutesAgo(10) },
      { social_account_id: 'many-posts', external_publication_id: 'post-2', status: 'SENT', sent_at: minutesAgo(5) },
      { social_account_id: 'many-posts', external_publication_id: 'post-3', status: 'SENT', sent_at: minutesAgo(1) },
    ],
  });
  let receivedIds;
  const { run } = createMetricsSync({
    query: db.query,
    syncMetrics: async (accountId, provider, ids) => {
      receivedIds = ids;
    },
  });

  const result = await run({ staleAfterMinutes: 60, targetsPerAccount: 2 });

  assert.deepEqual(result, { inspected: 1, synced: 1, skipped: 0, failed: 0 });
  assert.equal(receivedIds.length, 2);
  // Les plus récemment envoyées d'abord — ce sont celles qu'un community
  // manager consulte réellement.
  assert.deepEqual(receivedIds, ['post-3', 'post-2']);
});

test('un compte en échec de synchronisation n’interrompt pas les suivants', async () => {
  const db = createFakeDb({
    socialAccounts: [
      { id: 'will-fail', provider: 'FACEBOOK', status: 'CONNECTED', last_metrics_sync_at: null },
      { id: 'will-succeed', provider: 'INSTAGRAM', status: 'CONNECTED', last_metrics_sync_at: null },
    ],
    targets: [
      { social_account_id: 'will-fail', external_publication_id: 'post-1', status: 'SENT' },
      { social_account_id: 'will-succeed', external_publication_id: 'post-2', status: 'SENT' },
    ],
  });
  const { run } = createMetricsSync({
    query: db.query,
    syncMetrics: async (accountId) => {
      if (accountId === 'will-fail') throw new Error('provider_unavailable');
    },
    logger: { warn() {} },
  });

  const result = await run({ staleAfterMinutes: 60 });

  assert.deepEqual(result, { inspected: 2, synced: 1, skipped: 0, failed: 1 });
});

test('un compte déconnecté n’est jamais repris', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'gone', provider: 'FACEBOOK', status: 'DISCONNECTED', last_metrics_sync_at: null }],
    targets: [{ social_account_id: 'gone', external_publication_id: 'post-1', status: 'SENT' }],
  });
  const { run } = createMetricsSync({ query: db.query, syncMetrics: async () => {} });

  const result = await run({ staleAfterMinutes: 60 });

  assert.deepEqual(result, { inspected: 0, synced: 0, skipped: 0, failed: 0 });
});
