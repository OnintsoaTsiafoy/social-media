import assert from 'node:assert/strict';
import test from 'node:test';

import { createCompetitorSync, engagementRatePercent } from '../src/competitor-sync.js';
import { createFakeDb } from './fake-db.js';

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function fixture(overrides = {}) {
  return createFakeDb({
    competitors: [
      {
        id: 'rival-1',
        brand_id: 'brand-1',
        platform: 'INSTAGRAM',
        username: 'rival',
        external_id: null,
        name: 'Rival',
        profile_url: null,
        avatar_url: 'https://cdn/old-avatar.png',
        status: 'ACTIVE',
        last_synced_at: null,
      },
    ],
    socialAccounts: [{ id: 'account-1', brand_id: 'brand-1', provider: 'INSTAGRAM', status: 'CONNECTED' }],
    ...overrides,
  });
}

function sync(db, handlers = {}) {
  const enqueued = [];
  const service = createCompetitorSync({
    query: db.query,
    fetchProfile: handlers.fetchProfile ?? (async () => ({ status: 'ACTIVE' })),
    fetchPosts: handlers.fetchPosts ?? (async () => ({ status: 'ACTIVE', posts: [] })),
    fetchAudience: handlers.fetchAudience ?? (async () => ({ status: 'ACTIVE', followersCount: null })),
    enqueue: async (queue, data) => enqueued.push({ queue, data }),
    logger: { warn() {} },
  });
  return { service, enqueued };
}

// ---------------------------------------------------------------------------
// Étape 1 : profil
// ---------------------------------------------------------------------------

test('un profil lisible met à jour l’identité, relève l’audience de la marque et enchaîne', async () => {
  const db = fixture();
  const { service, enqueued } = sync(db, {
    fetchProfile: async () => ({
      status: 'ACTIVE',
      externalId: '17841400000000000',
      name: 'Rival Brand',
      profileUrl: 'https://www.instagram.com/rival/',
      avatarUrl: 'https://cdn/new-avatar.png',
      followersCount: 12_000,
      postsCount: 340,
    }),
    fetchAudience: async () => ({ status: 'ACTIVE', followersCount: 8_400 }),
  });

  const result = await service.syncProfile({ competitorId: 'rival-1' });

  assert.equal(result.status, 'ACTIVE');
  const competitor = db.state.competitors[0];
  assert.equal(competitor.external_id, '17841400000000000');
  assert.equal(competitor.name, 'Rival Brand');
  assert.equal(competitor.status, 'ACTIVE');
  assert.ok(competitor.last_synced_at);

  // L'audience de la marque est relevée dans la même passe : sans elle, le
  // taux d'engagement des deux côtés ne serait pas calculable pareil.
  assert.equal(db.state.socialAccounts[0].followers_count, 8_400);

  assert.deepEqual(enqueued.map((entry) => entry.queue), ['sync-competitor-posts']);
  assert.equal(enqueued[0].data.followersCount, 12_000);
});

test('un refus Meta enregistre le statut sans effacer les données déjà connues', async () => {
  const db = fixture();
  const { service, enqueued } = sync(db, {
    fetchProfile: async () => ({
      status: 'PERMISSION_REQUIRED',
      errorCode: 'forbidden',
      errorMessage: 'Page Public Content Access requis.',
    }),
  });

  const result = await service.syncProfile({ competitorId: 'rival-1' });

  assert.equal(result.status, 'PERMISSION_REQUIRED');
  const competitor = db.state.competitors[0];
  assert.equal(competitor.status, 'PERMISSION_REQUIRED');
  assert.equal(competitor.last_error_code, 'forbidden');
  // Dernière donnée connue conservée avec sa date (section 11 du TODO).
  assert.equal(competitor.name, 'Rival');
  assert.equal(competitor.avatar_url, 'https://cdn/old-avatar.png');
  // Rien n'est enchaîné : inutile de demander des publications illisibles.
  assert.deepEqual(enqueued, []);
});

test('une panne de transport est transitoire, pas une indisponibilité du concurrent', async () => {
  const db = fixture();
  const { service } = sync(db, {
    fetchProfile: async () => {
      throw new Error('provider_unavailable');
    },
  });

  const result = await service.syncProfile({ competitorId: 'rival-1' });

  assert.equal(result.status, 'SYNC_ERROR');
  assert.equal(db.state.competitors[0].status, 'SYNC_ERROR');
  assert.equal(db.state.competitors[0].name, 'Rival');
});

test('sans compte social connecté, rien n’est demandé à Meta', async () => {
  const db = fixture({ socialAccounts: [] });
  let calls = 0;
  const { service } = sync(db, {
    fetchProfile: async () => {
      calls += 1;
      return { status: 'ACTIVE' };
    },
  });

  const result = await service.syncProfile({ competitorId: 'rival-1' });

  assert.equal(result.skipped, 'no_social_account');
  assert.equal(calls, 0);
  assert.equal(db.state.competitors[0].status, 'PERMISSION_REQUIRED');
});

test('l’échec du relevé d’audience ne compromet pas la collecte du concurrent', async () => {
  const db = fixture();
  const { service, enqueued } = sync(db, {
    fetchProfile: async () => ({ status: 'ACTIVE', name: 'Rival Brand', followersCount: 500 }),
    fetchAudience: async () => {
      throw new Error('provider_unavailable');
    },
  });

  const result = await service.syncProfile({ competitorId: 'rival-1' });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(db.state.competitors[0].name, 'Rival Brand');
  assert.equal(enqueued.length, 1);
});

// ---------------------------------------------------------------------------
// Étape 2 : publications
// ---------------------------------------------------------------------------

test('une publication déjà connue et inchangée ne produit aucune écriture', async () => {
  const db = fixture();
  const posts = [
    { externalPostId: 'p1', message: 'Bonjour', publishedAt: daysAgo(2), reactionsCount: 10, commentsCount: 2, sharesCount: null },
  ];
  const { service } = sync(db, { fetchPosts: async () => ({ status: 'ACTIVE', posts }) });

  const first = await service.syncPosts({ competitorId: 'rival-1', followersCount: 1000 });
  assert.deepEqual([first.inserted, first.updated, first.unchanged], [1, 0, 0]);

  const second = await service.syncPosts({ competitorId: 'rival-1', followersCount: 1000 });
  assert.deepEqual([second.inserted, second.updated, second.unchanged], [0, 0, 1]);
  assert.equal(db.state.competitorPosts.length, 1);
});

test('seules les métriques ayant changé déclenchent une mise à jour', async () => {
  const db = fixture();
  let reactions = 10;
  const { service } = sync(db, {
    fetchPosts: async () => ({
      status: 'ACTIVE',
      posts: [{ externalPostId: 'p1', message: 'Bonjour', publishedAt: daysAgo(2), reactionsCount: reactions, commentsCount: 2, sharesCount: null }],
    }),
  });

  await service.syncPosts({ competitorId: 'rival-1', followersCount: 1000 });
  reactions = 25;
  const result = await service.syncPosts({ competitorId: 'rival-1', followersCount: 1000 });

  assert.deepEqual([result.inserted, result.updated, result.unchanged], [0, 1, 0]);
  assert.equal(db.state.competitorPosts[0].reactions_count, 25);
});

test('un lot partiel est conservé et le refus est enregistré', async () => {
  const db = fixture();
  const { service } = sync(db, {
    fetchPosts: async () => ({
      status: 'SYNC_ERROR',
      errorCode: 'rate_limited',
      errorMessage: 'Trop de requêtes.',
      posts: [{ externalPostId: 'p1', publishedAt: daysAgo(1), reactionsCount: 3, commentsCount: 1, sharesCount: null }],
    }),
  });

  const result = await service.syncPosts({ competitorId: 'rival-1', followersCount: 100 });

  assert.equal(result.inserted, 1);
  assert.equal(db.state.competitorPosts.length, 1);
  assert.equal(db.state.competitors[0].status, 'SYNC_ERROR');
  assert.equal(db.state.competitors[0].last_error_code, 'rate_limited');
});

// ---------------------------------------------------------------------------
// Étape 3 : relevé agrégé
// ---------------------------------------------------------------------------

test('le relevé est ajouté sans jamais toucher aux précédents', async () => {
  const db = fixture({
    competitorMetrics: [
      { id: 'metric-0', competitor_id: 'rival-1', collected_at: daysAgo(3), followers_count: 900, engagement_rate: 1 },
    ],
  });
  db.state.competitorPosts.push(
    { id: 'p1', competitor_id: 'rival-1', external_post_id: 'p1', published_at: daysAgo(2), reactions_count: 100, comments_count: 20, shares_count: null },
    { id: 'p2', competitor_id: 'rival-1', external_post_id: 'p2', published_at: daysAgo(5), reactions_count: 200, comments_count: 40, shares_count: null }
  );

  const { service } = sync(db);
  const result = await service.syncMetrics({ competitorId: 'rival-1', followersCount: 1000, postsCount: 340 });

  assert.equal(result.posts, 2);
  assert.equal(result.interactions, 360);
  assert.equal(db.state.competitorMetrics.length, 2);
  // L'ancien relevé est intact : l'historique n'est jamais réécrit.
  assert.equal(db.state.competitorMetrics[0].engagement_rate, 1);

  const latest = db.state.competitorMetrics[1];
  // 360 interactions / 2 publications / 1000 abonnés = 18 %.
  assert.equal(latest.engagement_rate, 18);
  assert.equal(latest.posts_count, 340);
});

test('sans abonnés dans la charge, le dernier chiffre connu est repris', async () => {
  const db = fixture({
    competitorMetrics: [
      { id: 'metric-0', competitor_id: 'rival-1', collected_at: daysAgo(1), followers_count: 5000, engagement_rate: null },
    ],
  });

  const { service } = sync(db);
  const result = await service.syncMetrics({ competitorId: 'rival-1' });

  assert.equal(result.followers, 5000);
});

test('aucun compteur connu donne un relevé nul, jamais un relevé à zéro', async () => {
  const db = fixture();
  db.state.competitorPosts.push({
    id: 'p1',
    competitor_id: 'rival-1',
    external_post_id: 'p1',
    published_at: daysAgo(2),
    reactions_count: null,
    comments_count: null,
    shares_count: null,
  });

  const { service } = sync(db);
  const result = await service.syncMetrics({ competitorId: 'rival-1', followersCount: 1000 });

  assert.equal(result.interactions, null);
  const metric = db.state.competitorMetrics[0];
  assert.equal(metric.reactions_count, null);
  assert.equal(metric.engagement_rate, null);
});

test('le taux d’engagement historisé reprend la formule de l’API, et rien sans un de ses termes', () => {
  assert.equal(engagementRatePercent({ interactions: 360, posts: 2, followers: 1000 }), 18);
  assert.equal(engagementRatePercent({ interactions: null, posts: 2, followers: 1000 }), null);
  assert.equal(engagementRatePercent({ interactions: 360, posts: 0, followers: 1000 }), null);
  assert.equal(engagementRatePercent({ interactions: 360, posts: 2, followers: null }), null);
});

// ---------------------------------------------------------------------------
// Balayage périodique
// ---------------------------------------------------------------------------

test('le balayage n’appelle pas Meta : il n’élit que des candidats', async () => {
  const db = createFakeDb({
    competitors: [
      { id: 'never', brand_id: 'b', platform: 'INSTAGRAM', username: 'a', status: 'ACTIVE', last_synced_at: null },
      { id: 'stale', brand_id: 'b', platform: 'INSTAGRAM', username: 'b', status: 'ACTIVE', last_synced_at: minutesAgo(2000) },
      { id: 'fresh', brand_id: 'b', platform: 'INSTAGRAM', username: 'c', status: 'ACTIVE', last_synced_at: minutesAgo(10) },
    ],
  });
  let calls = 0;
  const { service, enqueued } = sync(db, {
    fetchProfile: async () => {
      calls += 1;
      return { status: 'ACTIVE' };
    },
  });

  const result = await service.sweep({ staleAfterMinutes: 720, limit: 25 });

  assert.deepEqual(result, { inspected: 2, queued: 2 });
  assert.equal(calls, 0);
  assert.deepEqual(enqueued.map((entry) => entry.data.competitorId).sort(), ['never', 'stale']);
});

test('un concurrent illisible est re-testé beaucoup plus rarement, jamais abandonné', async () => {
  const db = createFakeDb({
    competitors: [
      { id: 'gone-recent', brand_id: 'b', platform: 'FACEBOOK', username: 'x', status: 'UNAVAILABLE', last_synced_at: minutesAgo(2000) },
      { id: 'gone-old', brand_id: 'b', platform: 'FACEBOOK', username: 'y', status: 'UNAVAILABLE', last_synced_at: minutesAgo(20_000) },
    ],
  });
  const { service, enqueued } = sync(db);

  const result = await service.sweep({ staleAfterMinutes: 720, unavailableStaleAfterMinutes: 10_080 });

  assert.equal(result.queued, 1);
  assert.equal(enqueued[0].data.competitorId, 'gone-old');
});
