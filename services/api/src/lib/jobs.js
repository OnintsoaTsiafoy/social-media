/**
 * Producteur pg-boss côté API.
 *
 * L'API ne publie jamais elle-même vers un réseau social : elle crée un job
 * persistant en base et répond `202`. Le worker l'exécute, ce qui garantit
 * qu'un redémarrage — de l'API comme du worker — ne perd pas l'envoi.
 */

import PgBoss from 'pg-boss';

import { ALL_QUEUES, QUEUES, singletonKeyFor } from '../../../shared/jobs.js';
import { HttpError } from './http.js';

export { QUEUES };

let bossPromise;

async function connect() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new HttpError(503, 'provider_unavailable', 'La file de travaux n’est pas configurée.');
  }

  const boss = new PgBoss({ connectionString, schema: process.env.PGBOSS_SCHEMA?.trim() || 'pgboss' });
  boss.on('error', (error) => console.error({ scope: 'pgboss', error: error?.message }));
  await boss.start();
  // pg-boss 10 exige que la file existe avant le premier envoi.
  for (const queue of ALL_QUEUES) await boss.createQueue(queue);
  return boss;
}

export async function getBoss() {
  if (!bossPromise) {
    bossPromise = connect().catch((error) => {
      // Une panne de connexion ne doit pas figer le processus sur une promesse
      // rejetée : le prochain appel retente.
      bossPromise = undefined;
      throw error;
    });
  }
  return bossPromise;
}

async function send(queue, data, options = {}, sendAt) {
  try {
    const boss = await getBoss();
    const jobOptions = { singletonKey: singletonKeyFor(data.publicationId), ...options };
    return sendAt
      ? await boss.sendAfter(queue, data, jobOptions, sendAt)
      : await boss.send(queue, data, jobOptions);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error({ scope: 'pgboss', queue, error: error?.message });
    throw new HttpError(503, 'provider_unavailable', 'Le service de publication différée est indisponible.');
  }
}

/**
 * @returns {Promise<string|null>} identifiant du job, ou `null` si un job est
 *   déjà en attente pour cette publication (clé singleton) — ce qui rend
 *   l'appel idempotent au lieu d'envoyer deux fois.
 */
export function enqueuePublishNow({ publicationId, requestedBy, idempotencyKey }) {
  return send(QUEUES.publishNow, { publicationId, requestedBy, idempotencyKey }, { retryLimit: 0 });
}

export function enqueueScheduledPublish({ publicationId, requestedBy, scheduledAt }) {
  return send(
    QUEUES.publishScheduled,
    { publicationId, requestedBy, scheduledAt },
    { retryLimit: 0 },
    new Date(scheduledAt)
  );
}

export function enqueueRetry({ publicationId, requestedBy, providers, attempt, delaySeconds = 0 }) {
  return send(
    QUEUES.retryFailed,
    { publicationId, requestedBy, providers, attempt },
    { retryLimit: 0 },
    new Date(Date.now() + delaySeconds * 1000)
  );
}

/** Annule un job planifié ; une planification supprimée ne doit jamais partir. */
export async function cancelJob(queue, jobId) {
  if (!jobId) return false;
  try {
    const boss = await getBoss();
    await boss.cancel(queue, jobId);
    return true;
  } catch (error) {
    console.error({ scope: 'pgboss', action: 'cancel', queue, jobId, error: error?.message });
    return false;
  }
}

export async function stopBoss() {
  if (!bossPromise) return;
  const pending = bossPromise;
  bossPromise = undefined;
  try {
    const boss = await pending;
    await boss.stop({ graceful: true, wait: false });
  } catch {
    // Un arrêt de file non gracieux ne doit pas empêcher l'arrêt du processus.
  }
}
