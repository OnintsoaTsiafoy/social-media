/**
 * Worker Hootly.
 *
 * Il n'expose aucune API publique : il consomme les files pg-boss créées par
 * l'API Express et exécute les envois. Les sondes HTTP restent disponibles pour
 * Compose et pour `scripts/verify-readiness.ps1`.
 */

import http from 'node:http';

import PgBoss from 'pg-boss';

import { ALL_QUEUES, QUEUES } from '../shared/jobs.js';
import { createMediaCleanup } from './src/cleanup-media.js';
import { createDeliveryService } from './src/delivery.js';
import { closePool, query } from './src/db.js';
import { deleteObject, isStorageConfigured } from './src/storage.js';

const port = Number(process.env.PORT ?? 3001);
const state = { boss: undefined, queues: [], startedAt: undefined, lastError: undefined };

async function startBoss() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL est absent.');

  const boss = new PgBoss({ connectionString, schema: process.env.PGBOSS_SCHEMA?.trim() || 'pgboss' });
  boss.on('error', (error) => {
    state.lastError = error?.message;
    console.error({ scope: 'pgboss', error: error?.message });
  });

  await boss.start();
  for (const queue of ALL_QUEUES) await boss.createQueue(queue);

  const delivery = createDeliveryService({
    query,
    scheduleRetry: ({ publicationId, providers, attempt, requestedBy, delaySeconds }) =>
      boss.sendAfter(
        QUEUES.retryFailed,
        { publicationId, providers, attempt, requestedBy },
        { singletonKey: `publication:${publicationId}`, retryLimit: 0 },
        new Date(Date.now() + delaySeconds * 1000)
      ),
  });

  const mediaCleanup = createMediaCleanup({ query, deleteObject });

  await boss.work(QUEUES.publishScheduled, async (jobs) => {
    for (const job of jobs) {
      await delivery.publish({ ...job.data, requireSchedule: true });
    }
  });

  await boss.work(QUEUES.publishNow, async (jobs) => {
    for (const job of jobs) {
      await delivery.publish({ ...job.data });
    }
  });

  await boss.work(QUEUES.retryFailed, async (jobs) => {
    for (const job of jobs) {
      await delivery.publish({ ...job.data });
    }
  });

  await boss.work(QUEUES.cleanupTemporaryMedia, async (jobs) => {
    for (const job of jobs) {
      if (!isStorageConfigured()) {
        console.warn({ scope: 'cleanup-media', skipped: 'storage_not_configured' });
        continue;
      }
      const result = await mediaCleanup.cleanup(job.data ?? {});
      console.log({ scope: 'cleanup-media', ...result });
    }
  });

  // Nettoyage horaire des objets temporaires laissés par un composeur abandonné.
  await boss.schedule(QUEUES.cleanupTemporaryMedia, '0 * * * *', { olderThanHours: 24 });

  state.boss = boss;
  state.queues = ALL_QUEUES;
  state.startedAt = new Date().toISOString();
  console.log({ scope: 'worker', message: 'files pg-boss démarrées', queues: ALL_QUEUES });
  return boss;
}

const server = http.createServer((request, response) => {
  const body = (status, payload) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  };

  if (request.url === '/health') {
    body(200, { status: 'ok', service: 'worker' });
    return;
  }

  if (request.url === '/ready') {
    const missing = [];
    if (!process.env.DATABASE_URL?.trim()) missing.push('DATABASE_URL');
    if (missing.length > 0) {
      body(503, { status: 'not_ready', service: 'worker', reason: 'database_url_missing', missing });
      return;
    }
    if (!state.boss) {
      body(503, { status: 'not_ready', service: 'worker', reason: 'queues_not_started' });
      return;
    }
    body(200, { status: 'ready', service: 'worker', queues: state.queues });
    return;
  }

  // Sonde d'exploitation interne. L'authentification par JWT de service est
  // ajoutée au Sprint 05, avec le durcissement de `/internal/v1`.
  if (request.url === '/internal/v1/jobs/health') {
    body(state.boss ? 200 : 503, {
      status: state.boss ? 'UP' : 'DOWN',
      workers: state.queues.length,
      queues: state.queues,
      startedAt: state.startedAt ?? null,
      lastError: state.lastError ?? null,
    });
    return;
  }

  if (request.url === '/openapi.json') {
    body(200, {
      openapi: '3.1.0',
      info: { title: 'Hootly Worker Operations API', version: '0.2.0' },
      paths: {
        '/health': { get: { summary: 'Liveness probe' } },
        '/ready': { get: { summary: 'Readiness probe' } },
        '/internal/v1/jobs/health': { get: { summary: 'État des files pg-boss' } },
      },
    });
    return;
  }

  body(404, { error: { code: 'not_found', message: 'Route inconnue.' } });
});

server.listen(port, () => console.log(`Hootly worker health endpoint listening on ${port}`));

// Les sondes doivent répondre même si PostgreSQL n'est pas encore prêt : le
// démarrage des files est retenté, sans faire tomber le processus.
function scheduleBossStart(attempt = 1) {
  startBoss().catch((error) => {
    state.lastError = error?.message;
    console.error({ scope: 'worker', message: 'démarrage des files impossible', error: error?.message, attempt });
    setTimeout(() => scheduleBossStart(attempt + 1), Math.min(30_000, attempt * 5_000)).unref();
  });
}

scheduleBossStart();

async function shutdown(signal) {
  console.log({ scope: 'worker', message: `arrêt demandé (${signal})` });
  try {
    // `graceful` laisse les jobs en cours se terminer ; ceux qui restent en file
    // seront repris au redémarrage, sans perte.
    if (state.boss) await state.boss.stop({ graceful: true, wait: true, timeout: 8_000 });
  } catch (error) {
    console.error({ scope: 'worker', error: error?.message });
  }
  await closePool();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
