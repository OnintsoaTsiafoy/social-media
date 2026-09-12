import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeliveryService } from '../src/delivery.js';
import { createFakeDb } from './fake-db.js';

const PUBLICATION_ID = 'b3f1c6b0-0000-4000-8000-000000000001';

function scenario({ content = 'Nouvelle collection', status = 'SCHEDULED', targets, schedule } = {}) {
  const db = createFakeDb({
    publications: [
      { id: PUBLICATION_ID, brand_id: 'brand-1', content, hashtags: ['automne'], status, published_at: null },
    ],
    targets: targets ?? [
      { id: 'target-fb', publication_id: PUBLICATION_ID, provider: 'FACEBOOK', status: 'PENDING', attempt_count: 0 },
      { id: 'target-ig', publication_id: PUBLICATION_ID, provider: 'INSTAGRAM', status: 'PENDING', attempt_count: 0 },
    ],
    schedules: schedule ? [{ publication_id: PUBLICATION_ID, status: schedule }] : [],
  });

  const retries = [];
  const service = createDeliveryService({
    query: db.query,
    scheduleRetry: async (command) => {
      retries.push(command);
      return 'job-retry';
    },
    logger: { log() {} },
  });

  return { db, service, retries };
}

test('scénario nominal : les deux réseaux reçoivent la publication', async () => {
  const { db, service } = scenario({ schedule: 'PENDING' });

  const result = await service.publish({ publicationId: PUBLICATION_ID, requireSchedule: true });

  assert.equal(result.status, 'PUBLISHED');
  assert.deepEqual(db.state.targets.map((target) => target.status), ['SENT', 'SENT']);
  assert.ok(db.state.publications[0].published_at);
  assert.equal(db.state.schedules[0].status, 'DISPATCHED');
  assert.deepEqual(db.state.attempts.map((attempt) => attempt.status), ['SUCCEEDED', 'SUCCEEDED']);
});

test('le provider reçoit le compte social résolu et les URL de médias signées (Sprint 07)', async () => {
  const db = createFakeDb({
    publications: [
      { id: PUBLICATION_ID, brand_id: 'brand-1', content: 'Une photo', hashtags: [], status: 'SCHEDULED', published_at: null },
    ],
    targets: [
      {
        id: 'target-fb',
        publication_id: PUBLICATION_ID,
        provider: 'FACEBOOK',
        social_account_id: 'account-42',
        status: 'PENDING',
        attempt_count: 0,
      },
    ],
    publicationMedia: [{ publication_id: PUBLICATION_ID, bucket: 'hootly', object_key: 'brands/b1/publications/p1/photo.jpg' }],
  });

  const commands = [];
  const service = createDeliveryService({
    query: db.query,
    provider: {
      deliver: async (command) => {
        commands.push(command);
        return { provider: command.provider, externalPublicationId: 'ext-1' };
      },
    },
    signMedia: async (bucket, key) => ({ url: `https://cdn.example.com/${bucket}/${key}?sig=abc` }),
    logger: { log() {} },
  });

  await service.publish({ publicationId: PUBLICATION_ID });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].socialAccountId, 'account-42');
  assert.equal(commands[0].publicationTargetId, 'target-fb');
  assert.deepEqual(commands[0].mediaUrls, ['https://cdn.example.com/hootly/brands/b1/publications/p1/photo.jpg?sig=abc']);
});

test('sans média rattaché, mediaUrls est un tableau vide (le mock l’ignore de toute façon)', async () => {
  const { service } = scenario({ schedule: 'PENDING' });

  const result = await service.publish({ publicationId: PUBLICATION_ID, requireSchedule: true });

  assert.equal(result.status, 'PUBLISHED');
});

test('échec d’un seul réseau : statut partiel et retry programmé', async () => {
  const { db, service, retries } = scenario({ content: 'Promo [[FAIL_INSTAGRAM]]' });

  const result = await service.publish({ publicationId: PUBLICATION_ID });

  assert.equal(result.status, 'PARTIALLY_PUBLISHED');
  assert.equal(db.state.targets.find((target) => target.provider === 'FACEBOOK').status, 'SENT');
  assert.equal(db.state.targets.find((target) => target.provider === 'INSTAGRAM').status, 'FAILED');
  // Retry automatique du seul réseau en échec, après une minute.
  assert.equal(retries.length, 1);
  assert.deepEqual(retries[0].providers, ['INSTAGRAM']);
  assert.equal(retries[0].delaySeconds, 60);
});

test('erreur temporaire : la publication échoue et repart en retry', async () => {
  const { db, service, retries } = scenario({ content: 'Alerte [[TIMEOUT]]' });

  const result = await service.publish({ publicationId: PUBLICATION_ID });

  assert.equal(result.status, 'FAILED');
  assert.equal(db.state.publications[0].status, 'FAILED');
  assert.equal(retries.length, 2);
  assert.deepEqual(
    db.state.targets.map((target) => target.last_error_code),
    ['provider_timeout', 'provider_timeout']
  );
});

test('erreur permanente : aucun retry automatique', async () => {
  const { service, retries } = scenario({ content: 'Contenu interdit [[FAIL_PERM]]' });

  const result = await service.publish({ publicationId: PUBLICATION_ID });

  assert.equal(result.status, 'FAILED');
  assert.equal(retries.length, 0);
});

test('un job rejoué après un envoi complet ne renvoie rien', async () => {
  const { db, service } = scenario();

  await service.publish({ publicationId: PUBLICATION_ID });
  const attemptsAfterFirstRun = db.state.attempts.length;

  // Rejeu du même job, comme après un redémarrage brutal du worker.
  const replay = await service.publish({ publicationId: PUBLICATION_ID });

  assert.equal(replay.skipped, 'not_publishable');
  assert.equal(db.state.attempts.length, attemptsAfterFirstRun);
  assert.equal(db.state.publications[0].status, 'PUBLISHED');
});

test('reprise après crash : seule la cible non traitée repart', async () => {
  // État laissé par un worker tué entre les deux réseaux.
  const { db, service } = scenario({
    status: 'PUBLISHING',
    targets: [
      { id: 'target-fb', publication_id: PUBLICATION_ID, provider: 'FACEBOOK', status: 'SENT', attempt_count: 1 },
      { id: 'target-ig', publication_id: PUBLICATION_ID, provider: 'INSTAGRAM', status: 'PENDING', attempt_count: 0 },
    ],
  });

  const result = await service.publish({ publicationId: PUBLICATION_ID });

  assert.equal(result.status, 'PUBLISHED');
  assert.deepEqual(result.results.map((entry) => entry.provider), ['INSTAGRAM']);
  assert.equal(db.state.attempts.length, 1);
});

test('une tentative déjà enregistrée n’est pas exécutée une seconde fois', async () => {
  const { db, service } = scenario();
  // La clé d'idempotence de la première tentative Facebook existe déjà : le job
  // a été interrompu après l'enregistrement, avant l'appel réseau.
  db.state.attempts.push({
    id: 'attempt-existant',
    publication_target_id: 'target-fb',
    attempt_number: 1,
    idempotency_key: `${PUBLICATION_ID}:FACEBOOK:1`,
    status: 'STARTED',
  });

  const result = await service.publish({ publicationId: PUBLICATION_ID });

  const facebook = result.results.find((entry) => entry.provider === 'FACEBOOK');
  assert.equal(facebook.skipped, 'attempt_already_recorded');
  assert.equal(db.state.targets.find((target) => target.provider === 'FACEBOOK').status, 'SENDING');
  assert.equal(db.state.targets.find((target) => target.provider === 'INSTAGRAM').status, 'SENT');
  // Une cible encore en cours maintient la publication en « publishing ».
  assert.equal(result.status, 'PUBLISHING');
});

test('une cible déjà envoyée n’est pas renvoyée lors d’un retry', async () => {
  const { db, service } = scenario({
    status: 'PARTIALLY_PUBLISHED',
    targets: [
      {
        id: 'target-fb',
        publication_id: PUBLICATION_ID,
        provider: 'FACEBOOK',
        status: 'SENT',
        attempt_count: 1,
        external_publication_id: 'fa_x_1',
      },
      { id: 'target-ig', publication_id: PUBLICATION_ID, provider: 'INSTAGRAM', status: 'FAILED', attempt_count: 1 },
    ],
  });

  const result = await service.publish({ publicationId: PUBLICATION_ID, providers: ['INSTAGRAM'], attempt: 2 });

  assert.equal(result.status, 'PUBLISHED');
  assert.deepEqual(result.results.map((entry) => entry.provider), ['INSTAGRAM']);
  // L'identifiant externe du réseau déjà publié reste celui de la première fois.
  assert.equal(db.state.targets[0].external_publication_id, 'fa_x_1');
  assert.equal(db.state.targets[1].attempt_count, 2);
});

test('une planification annulée n’envoie rien', async () => {
  const { db, service } = scenario({ schedule: 'CANCELLED' });

  const result = await service.publish({ publicationId: PUBLICATION_ID, requireSchedule: true });

  assert.equal(result.skipped, 'schedule_not_pending');
  assert.deepEqual(db.state.targets.map((target) => target.status), ['PENDING', 'PENDING']);
  assert.equal(db.state.attempts.length, 0);
});

test('une publication supprimée ou déjà publiée n’est pas reprise', async () => {
  const deleted = scenario();
  deleted.db.state.publications[0].deleted_at = new Date().toISOString();
  assert.equal((await deleted.service.publish({ publicationId: PUBLICATION_ID })).skipped, 'not_publishable');

  const published = scenario({ status: 'PUBLISHED' });
  assert.equal((await published.service.publish({ publicationId: PUBLICATION_ID })).skipped, 'not_publishable');
});

test('le statut global est recalculé même sans nouvelle cible à envoyer', async () => {
  const { db, service } = scenario({
    status: 'PUBLISHING',
    targets: [
      { id: 'target-fb', publication_id: PUBLICATION_ID, provider: 'FACEBOOK', status: 'SENT', attempt_count: 1 },
      { id: 'target-ig', publication_id: PUBLICATION_ID, provider: 'INSTAGRAM', status: 'SENT', attempt_count: 1 },
    ],
  });

  const result = await service.publish({ publicationId: PUBLICATION_ID });

  assert.equal(result.status, 'PUBLISHED');
  assert.equal(db.state.publications[0].status, 'PUBLISHED');
});
