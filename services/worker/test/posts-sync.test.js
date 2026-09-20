import assert from 'node:assert/strict';
import test from 'node:test';

import { createPostsSync } from '../src/posts-sync.js';
import { createFakeDb } from './fake-db.js';

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

const empty = { created: 0, updated: 0, unchanged: 0, skipped: 0 };

/** Un double de graph-api qui répond page après page, comme le vrai (curseur de reprise). */
function pagedGraphApi(pages, { mode = 'initial' } = {}) {
  const calls = [];
  const syncPosts = async (accountId, provider, cursor) => {
    calls.push({ accountId, provider, cursor });
    const index = cursor ? Number(cursor.replace('c', '')) : 0;
    const last = index >= pages.length - 1;
    return { mode, ...empty, ...pages[index], nextCursor: last ? null : `c${index + 1}`, done: last };
  };
  return { syncPosts, calls };
}

test('un compte est importé appel après appel, avec le curseur de reprise, jusqu’à la fin du fil', async () => {
  const graph = pagedGraphApi([{ created: 150 }, { created: 150 }, { created: 40, updated: 2, unchanged: 7, skipped: 1 }]);
  const { syncAccount } = createPostsSync({ query: async () => [], syncPosts: graph.syncPosts });

  const result = await syncAccount({ id: 'acc-1', provider: 'FACEBOOK' });

  assert.deepEqual(graph.calls.map((call) => call.cursor), [null, 'c1', 'c2']);
  assert.deepEqual(result, {
    mode: 'initial', created: 340, updated: 2, unchanged: 7, skipped: 1, calls: 3, done: true,
  });
});

test('le mode rapporté est celui de graph-api, pas une décision du worker', async () => {
  const graph = pagedGraphApi([{ created: 1 }], { mode: 'incremental' });
  const { syncAccount } = createPostsSync({ query: async () => [], syncPosts: graph.syncPosts });

  assert.equal((await syncAccount({ id: 'a', provider: 'FACEBOOK' })).mode, 'incremental');
});

test('une boucle sans fin est bornée et rendue inachevée, sans erreur', async () => {
  let calls = 0;
  const { syncAccount } = createPostsSync({
    query: async () => [],
    syncPosts: async () => {
      calls += 1;
      return { mode: 'initial', ...empty, created: 1, nextCursor: `c${calls}`, done: false };
    },
  });

  const result = await syncAccount({ id: 'a', provider: 'FACEBOOK' }, { maxCalls: 4 });

  assert.equal(calls, 4);
  assert.equal(result.done, false);
  assert.equal(result.created, 4);
});

test('une réponse inachevée sans curseur est une erreur, pas une boucle sur la première page', async () => {
  let calls = 0;
  const { syncAccount } = createPostsSync({
    query: async () => [],
    syncPosts: async () => {
      calls += 1;
      return { mode: 'initial', ...empty, nextCursor: null, done: false };
    },
  });

  await assert.rejects(() => syncAccount({ id: 'a', provider: 'FACEBOOK' }), /posts_sync_cursor_missing/);
  assert.equal(calls, 1);
});

test('le balayage prend les comptes Facebook jamais importés d’abord, puis les plus anciens', async () => {
  const db = createFakeDb({
    socialAccounts: [
      { id: 'stale', provider: 'FACEBOOK', status: 'CONNECTED', last_posts_sync_at: minutesAgo(90) },
      { id: 'never', provider: 'FACEBOOK', status: 'CONNECTED', last_posts_sync_at: null },
      { id: 'fresh', provider: 'FACEBOOK', status: 'CONNECTED', last_posts_sync_at: minutesAgo(2) },
      { id: 'expiring', provider: 'FACEBOOK', status: 'EXPIRING', last_posts_sync_at: minutesAgo(45) },
      { id: 'disconnected', provider: 'FACEBOOK', status: 'DISCONNECTED', last_posts_sync_at: null },
      { id: 'reauth', provider: 'FACEBOOK', status: 'REAUTH_REQUIRED', last_posts_sync_at: null },
      { id: 'instagram', provider: 'INSTAGRAM', status: 'CONNECTED', last_posts_sync_at: null },
    ],
  });
  const graph = pagedGraphApi([{ created: 1 }]);
  const { sweep } = createPostsSync({ query: db.query, syncPosts: graph.syncPosts });

  const result = await sweep({ staleAfterMinutes: 20 });

  assert.deepEqual(result, { inspected: 3, synced: 3, incomplete: 0, failed: 0 });
  assert.deepEqual(graph.calls.map((call) => call.accountId), ['never', 'stale', 'expiring']);
  assert.ok(graph.calls.every((call) => call.provider === 'FACEBOOK'));
});

test('le balayage borne le nombre de comptes par passage', async () => {
  const db = createFakeDb({
    socialAccounts: Array.from({ length: 8 }, (_, index) => ({
      id: `acc-${index}`, provider: 'FACEBOOK', status: 'CONNECTED', last_posts_sync_at: null,
    })),
  });
  const graph = pagedGraphApi([{ created: 1 }]);
  const { sweep } = createPostsSync({ query: db.query, syncPosts: graph.syncPosts });

  const result = await sweep();

  // 5 par défaut : une passe initiale peut durer des minutes, le reste attend le
  // balayage suivant plutôt que de dépasser l'expiration du job.
  assert.equal(result.inspected, 5);
  assert.equal(graph.calls.length, 5);
});

test('un compte en échec n’interrompt pas les suivants', async () => {
  const db = createFakeDb({
    socialAccounts: [
      { id: 'will-fail', provider: 'FACEBOOK', status: 'CONNECTED', last_posts_sync_at: null },
      { id: 'will-succeed', provider: 'FACEBOOK', status: 'CONNECTED', last_posts_sync_at: minutesAgo(60) },
    ],
  });
  const warnings = [];
  const { sweep } = createPostsSync({
    query: db.query,
    syncPosts: async (accountId) => {
      if (accountId === 'will-fail') throw new Error('TOKEN_EXPIRED');
      return { mode: 'incremental', ...empty, done: true, nextCursor: null };
    },
    logger: { warn: (entry) => warnings.push(entry) },
  });

  const result = await sweep();

  assert.deepEqual(result, { inspected: 2, synced: 1, incomplete: 0, failed: 1 });
  assert.equal(warnings[0].socialAccountId, 'will-fail');
  assert.equal(warnings[0].error, 'TOKEN_EXPIRED');
});

test('un import inachevé est compté à part et sera repris du début au balayage suivant', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'huge', provider: 'FACEBOOK', status: 'CONNECTED', last_posts_sync_at: null }],
  });
  const { sweep } = createPostsSync({
    query: db.query,
    syncPosts: async () => ({ mode: 'initial', ...empty, nextCursor: 'more', done: false }),
  });

  // Rien n'est noté « achevé » côté worker : c'est graph-api seul qui écrit
  // last_posts_sync_at. Le compte reste donc éligible (dernière synchro vide).
  assert.deepEqual(await sweep({}), { inspected: 1, synced: 0, incomplete: 1, failed: 0 });
  assert.equal(db.state.socialAccounts[0].last_posts_sync_at, null);
});

test('un job ciblé importe le compte demandé', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'linked', provider: 'FACEBOOK', status: 'CONNECTED', last_posts_sync_at: null }],
  });
  const graph = pagedGraphApi([{ created: 12 }]);
  const { syncOne } = createPostsSync({ query: db.query, syncPosts: graph.syncPosts });

  const result = await syncOne('linked');

  assert.equal(result.socialAccountId, 'linked');
  assert.equal(result.created, 12);
  assert.equal(result.done, true);
});

test('un job ciblé sur un compte déconnecté, à reconnecter ou supprimé est ignoré sans erreur', async () => {
  const db = createFakeDb({
    socialAccounts: [
      { id: 'gone', provider: 'FACEBOOK', status: 'DISCONNECTED' },
      { id: 'expired', provider: 'FACEBOOK', status: 'REAUTH_REQUIRED' },
    ],
  });
  let calls = 0;
  const { syncOne } = createPostsSync({ query: db.query, syncPosts: async () => (calls += 1) });

  for (const id of ['gone', 'expired', 'never-existed']) {
    assert.deepEqual(await syncOne(id), { socialAccountId: id, skipped: 'account_unavailable' });
  }
  // Ni appel à graph-api, ni erreur : le job n'a pas à être retenté.
  assert.equal(calls, 0);
});

test('un compte Instagram est ignoré sans appeler graph-api', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'ig', provider: 'INSTAGRAM', status: 'CONNECTED', last_posts_sync_at: null }],
  });
  let calls = 0;
  const { syncOne } = createPostsSync({ query: db.query, syncPosts: async () => (calls += 1) });

  assert.deepEqual(await syncOne('ig'), { socialAccountId: 'ig', skipped: 'provider_not_supported' });
  assert.equal(calls, 0);
});

test('l’échec d’un job ciblé remonte, pour que le job soit marqué échoué', async () => {
  const db = createFakeDb({
    socialAccounts: [{ id: 'linked', provider: 'FACEBOOK', status: 'CONNECTED', last_posts_sync_at: null }],
  });
  const { syncOne } = createPostsSync({
    query: db.query,
    syncPosts: async () => {
      throw new Error('provider_unavailable');
    },
  });

  await assert.rejects(() => syncOne('linked'), /provider_unavailable/);
});
