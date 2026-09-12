import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommentSync } from '../src/comment-sync.js';
import { createFakeDb } from './fake-db.js';

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

test('reprend les comptes jamais synchronisés ou synchronisés il y a longtemps', async () => {
  const db = createFakeDb({
    socialAccounts: [
      { id: 'never-synced', provider: 'FACEBOOK', status: 'CONNECTED', last_comments_sync_at: null },
      { id: 'stale', provider: 'FACEBOOK', status: 'CONNECTED', last_comments_sync_at: minutesAgo(60) },
      { id: 'fresh', provider: 'FACEBOOK', status: 'CONNECTED', last_comments_sync_at: minutesAgo(1) },
      { id: 'disconnected', provider: 'FACEBOOK', status: 'DISCONNECTED', last_comments_sync_at: null },
    ],
    targets: [
      { social_account_id: 'never-synced', external_publication_id: 'post-1' },
      { social_account_id: 'stale', external_publication_id: 'post-2' },
    ],
  });
  const synced = [];
  const { run } = createCommentSync({
    query: db.query,
    syncComments: async (accountId, provider, ids) => synced.push({ accountId, provider, ids }),
  });

  const result = await run({ staleAfterMinutes: 15, limit: 50 });

  assert.deepEqual(result, { inspected: 2, synced: 2, skipped: 0, failed: 0 });
  assert.deepEqual(synced.map((entry) => entry.accountId).sort(), ['never-synced', 'stale']);
});

test('un compte sans post publié par Hootly est ignoré sans appeler graph-api', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'nothing-published', provider: 'FACEBOOK', status: 'CONNECTED', last_comments_sync_at: null }],
    targets: [],
  });
  let calls = 0;
  const { run } = createCommentSync({
    query: db.query,
    syncComments: async () => {
      calls += 1;
    },
  });

  const result = await run({ staleAfterMinutes: 15 });

  assert.deepEqual(result, { inspected: 1, synced: 0, skipped: 1, failed: 0 });
  assert.equal(calls, 0);
});

test('un compte en échec de synchronisation n’interrompt pas les suivants', async () => {
  const db = createFakeDb({
    socialAccounts: [
      { id: 'will-fail', provider: 'FACEBOOK', status: 'CONNECTED', last_comments_sync_at: null },
      { id: 'will-succeed', provider: 'INSTAGRAM', status: 'CONNECTED', last_comments_sync_at: null },
    ],
    targets: [
      { social_account_id: 'will-fail', external_publication_id: 'post-1' },
      { social_account_id: 'will-succeed', external_publication_id: 'post-2' },
    ],
  });
  const { run } = createCommentSync({
    query: db.query,
    syncComments: async (accountId) => {
      if (accountId === 'will-fail') throw new Error('provider_unavailable');
    },
    logger: { warn() {} },
  });

  const result = await run({ staleAfterMinutes: 15 });

  assert.deepEqual(result, { inspected: 2, synced: 1, skipped: 0, failed: 1 });
});

test('un compte déconnecté n’est jamais repris', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'gone', provider: 'FACEBOOK', status: 'DISCONNECTED', last_comments_sync_at: null }],
    targets: [{ social_account_id: 'gone', external_publication_id: 'post-1' }],
  });
  const { run } = createCommentSync({ query: db.query, syncComments: async () => {} });

  const result = await run({ staleAfterMinutes: 15 });

  assert.deepEqual(result, { inspected: 0, synced: 0, skipped: 0, failed: 0 });
});
