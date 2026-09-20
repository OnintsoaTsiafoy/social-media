/**
 * Une marque archivée ne vit plus.
 *
 * Supprimer une marque est un archivage (`status = 'ARCHIVED'` + `deleted_at`,
 * voir services/api/src/brands/service.js). Côté API, tout répond ensuite 404.
 * Le worker, lui, lit PostgreSQL directement : sans filtre, une marque
 * « supprimée » continuait de publier sur Facebook et de consommer du quota
 * Meta pour synchroniser ses commentaires, ses métriques, ses jetons et ses
 * concurrents.
 *
 * Ces tests décrivent le silence attendu, pour chaque tâche périodique et pour
 * un job déjà en file au moment de l'archivage.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommentSync } from '../src/comment-sync.js';
import { createCompetitorSync } from '../src/competitor-sync.js';
import { createDeliveryService } from '../src/delivery.js';
import { createMetricsSync } from '../src/metrics-sync.js';
import { createTokenRefresh } from '../src/token-refresh.js';
import { createFakeDb } from './fake-db.js';

const PUBLICATION_ID = '11111111-1111-1111-1111-111111111111';

const ARCHIVED = { id: 'brand-archived', status: 'ARCHIVED', deleted_at: new Date().toISOString() };
const ALIVE = { id: 'brand-alive', status: 'ACTIVE', deleted_at: null };

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

test('publication : un job déjà en file n’envoie rien si la marque a été archivée', async () => {
  const db = createFakeDb({
    brands: [ARCHIVED],
    approvals: [{ publication_id: PUBLICATION_ID, revision: 1, status: 'APPROVED' }],
    publications: [
      {
        id: PUBLICATION_ID,
        content_revision: 1,
        approved_revision: 1,
        brand_id: ARCHIVED.id,
        content: 'Message prêt à partir',
        hashtags: [],
        status: 'SCHEDULED',
        published_at: null,
      },
    ],
    targets: [
      { id: 'target-fb', publication_id: PUBLICATION_ID, provider: 'FACEBOOK', status: 'PENDING', attempt_count: 0 },
    ],
    schedules: [{ publication_id: PUBLICATION_ID, status: 'PENDING' }],
  });

  let delivered = 0;
  const service = createDeliveryService({
    query: db.query,
    provider: {
      deliver: async () => {
        delivered += 1;
        return { externalPublicationId: 'never' };
      },
    },
    logger: { log() {}, warn() {} },
  });

  const result = await service.publish({ publicationId: PUBLICATION_ID, revision: 1, requireSchedule: true });

  assert.equal(result.skipped, 'brand_archived');
  assert.equal(delivered, 0, 'aucun appel au réseau social');
  assert.equal(db.state.targets[0].status, 'PENDING', 'la cible n’est pas réclamée');
  assert.equal(db.state.publications[0].status, 'SCHEDULED', 'la publication n’est pas passée à PUBLISHING');
  // La planification est annulée : sinon elle resterait « en attente » pour
  // toujours, et le calendrier annoncerait un envoi qui n'aura jamais lieu.
  assert.equal(db.state.schedules[0].status, 'CANCELLED');
});

test('publication : une marque encore active continue d’envoyer', async () => {
  const db = createFakeDb({
    brands: [ALIVE],
    approvals: [{ publication_id: PUBLICATION_ID, revision: 1, status: 'APPROVED' }],
    publications: [
      {
        id: PUBLICATION_ID,
        content_revision: 1,
        approved_revision: 1,
        brand_id: ALIVE.id,
        content: 'Message prêt à partir',
        hashtags: [],
        status: 'SCHEDULED',
        published_at: null,
      },
    ],
    targets: [
      { id: 'target-fb', publication_id: PUBLICATION_ID, provider: 'FACEBOOK', status: 'PENDING', attempt_count: 0 },
    ],
    schedules: [{ publication_id: PUBLICATION_ID, status: 'PENDING' }],
  });

  const service = createDeliveryService({ query: db.query, logger: { log() {}, warn() {} } });

  const result = await service.publish({ publicationId: PUBLICATION_ID, revision: 1, requireSchedule: true });

  assert.equal(result.status, 'PUBLISHED');
  assert.equal(db.state.targets[0].status, 'SENT');
});

test('commentaires : les comptes d’une marque archivée ne sont plus synchronisés', async () => {
  const db = createFakeDb({
    brands: [ARCHIVED, ALIVE],
    socialAccounts: [
      { id: 'compte-archive', brand_id: ARCHIVED.id, provider: 'FACEBOOK', status: 'CONNECTED', last_comments_sync_at: null },
      { id: 'compte-actif', brand_id: ALIVE.id, provider: 'FACEBOOK', status: 'CONNECTED', last_comments_sync_at: null },
    ],
    targets: [
      { social_account_id: 'compte-archive', external_publication_id: 'post-archive' },
      { social_account_id: 'compte-actif', external_publication_id: 'post-actif' },
    ],
  });
  const synced = [];
  const { run } = createCommentSync({
    query: db.query,
    syncComments: async (accountId) => synced.push(accountId),
  });

  const result = await run({ staleAfterMinutes: 15, limit: 50 });

  assert.deepEqual(synced, ['compte-actif']);
  assert.equal(result.inspected, 1);
});

test('métriques : les comptes d’une marque archivée ne sont plus relevés', async () => {
  const db = createFakeDb({
    brands: [ARCHIVED, ALIVE],
    socialAccounts: [
      { id: 'compte-archive', brand_id: ARCHIVED.id, provider: 'FACEBOOK', status: 'CONNECTED', last_metrics_sync_at: null },
      { id: 'compte-actif', brand_id: ALIVE.id, provider: 'FACEBOOK', status: 'CONNECTED', last_metrics_sync_at: null },
    ],
    targets: [
      { social_account_id: 'compte-archive', external_publication_id: 'post-archive', status: 'SENT', sent_at: hoursAgo(1) },
      { social_account_id: 'compte-actif', external_publication_id: 'post-actif', status: 'SENT', sent_at: hoursAgo(1) },
    ],
  });
  const synced = [];
  const { run } = createMetricsSync({
    query: db.query,
    syncMetrics: async (accountId) => {
      synced.push(accountId);
      return { synced: 1 };
    },
  });

  const result = await run({ staleAfterMinutes: 30, limit: 50 });

  assert.deepEqual(synced, ['compte-actif']);
  assert.equal(result.inspected, 1);
});

test('jetons : les comptes d’une marque archivée ne sont plus revalidés auprès de Meta', async () => {
  const db = createFakeDb({
    brands: [ARCHIVED, ALIVE],
    socialAccounts: [
      { id: 'compte-archive', brand_id: ARCHIVED.id, provider: 'FACEBOOK', status: 'CONNECTED', updated_at: hoursAgo(48) },
      { id: 'compte-actif', brand_id: ALIVE.id, provider: 'FACEBOOK', status: 'CONNECTED', updated_at: hoursAgo(48) },
    ],
  });
  const refreshed = [];
  const { run } = createTokenRefresh({
    query: db.query,
    refreshToken: async (accountId) => refreshed.push(accountId),
  });

  const result = await run({ expiringWithinHours: 24, staleAfterHours: 24, limit: 50 });

  assert.deepEqual(refreshed, ['compte-actif']);
  assert.equal(result.inspected, 1);
});

test('concurrents : le balayage ignore ceux d’une marque archivée', async () => {
  const db = createFakeDb({
    brands: [ARCHIVED, ALIVE],
    competitors: [
      { id: 'concurrent-archive', brand_id: ARCHIVED.id, platform: 'FACEBOOK', status: 'ACTIVE', last_synced_at: null },
      { id: 'concurrent-actif', brand_id: ALIVE.id, platform: 'FACEBOOK', status: 'ACTIVE', last_synced_at: null },
    ],
  });
  const queued = [];
  const { sweep } = createCompetitorSync({
    query: db.query,
    enqueue: async (queue, data) => queued.push(data.competitorId),
    logger: { log() {}, warn() {} },
  });

  const result = await sweep({ limit: 25 });

  assert.deepEqual(queued, ['concurrent-actif']);
  assert.equal(result.inspected, 1);
});

test('concurrents : un job ciblé enfilé avant l’archivage n’appelle pas Meta', async () => {
  const db = createFakeDb({
    brands: [ARCHIVED],
    competitors: [
      { id: 'concurrent-archive', brand_id: ARCHIVED.id, platform: 'FACEBOOK', status: 'ACTIVE', last_synced_at: null },
    ],
    socialAccounts: [
      { id: 'compte-archive', brand_id: ARCHIVED.id, provider: 'FACEBOOK', status: 'CONNECTED' },
    ],
  });
  let calls = 0;
  const { syncProfile, syncPosts, syncMetrics } = createCompetitorSync({
    query: db.query,
    fetchProfile: async () => {
      calls += 1;
      return {};
    },
    fetchPosts: async () => {
      calls += 1;
      return {};
    },
    enqueue: async () => {},
    logger: { log() {}, warn() {} },
  });

  assert.equal((await syncProfile({ competitorId: 'concurrent-archive' })).skipped, 'brand_archived');
  assert.equal((await syncPosts({ competitorId: 'concurrent-archive' })).skipped, 'brand_archived');
  assert.equal((await syncMetrics({ competitorId: 'concurrent-archive' })).skipped, 'brand_archived');
  assert.equal(calls, 0, 'aucun appel Meta');
});
