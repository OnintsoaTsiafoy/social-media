/**
 * Producteur pg-boss côté API.
 *
 * L'API ne publie jamais elle-même vers un réseau social : elle crée un job
 * persistant en base et répond `202`. Le worker l'exécute, ce qui garantit
 * qu'un redémarrage — de l'API comme du worker — ne perd pas l'envoi.
 */

import PgBoss from 'pg-boss';

import {
  ALL_QUEUES,
  QUEUES,
  competitorSingletonKey,
  postsSyncSingletonKey,
  singletonKeyFor,
} from '../../../shared/jobs.js';
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
    // Sprint 12 : les jobs sans publicationId (ex. metrics-sync, keyé par
    // marque) passent leur propre singletonKey plutôt que de laisser
    // singletonKeyFor produire `publication:undefined`, qui collisionnerait
    // entre toutes les marques.
    const jobOptions = { singletonKey: options.singletonKey ?? singletonKeyFor(data.publicationId), ...options };
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
function transactionOptions(db) {
  return db ? { db: { executeSql: async (text, values) => ({ rows: await db.$queryRawUnsafe(text, ...values) }) } } : {};
}

export function enqueuePublishNow({ publicationId, requestedBy, idempotencyKey, revision }, db) {
  return send(QUEUES.publishNow, { publicationId, requestedBy, idempotencyKey, revision }, { retryLimit: 0, ...transactionOptions(db) });
}

export function enqueueScheduledPublish({ publicationId, requestedBy, scheduledAt, revision }, db) {
  return send(
    QUEUES.publishScheduled,
    { publicationId, requestedBy, scheduledAt, revision },
    { retryLimit: 0, ...transactionOptions(db) },
    new Date(scheduledAt)
  );
}

export function enqueueRetry({ publicationId, requestedBy, providers, attempt, revision, delaySeconds = 0 }, db) {
  return send(
    QUEUES.retryFailed,
    { publicationId, requestedBy, providers, attempt, revision },
    { retryLimit: 0, ...transactionOptions(db) },
    new Date(Date.now() + delaySeconds * 1000)
  );
}

/**
 * Sprint 12 : déclenchement à la demande de la synchronisation des métriques
 * (POST /api/v1/analytics/sync), sur la même file que la reprise
 * périodique du worker (voir services/worker/index.js).
 *
 * `singletonKey` seul ne suffit pas à dédupliquer ici : sans
 * `singletonSeconds`, pg-boss 10 laisse `singleton_on` à `null`, et l'index
 * partiel qui empêcherait deux jobs `created` avec la même clé ne s'applique
 * qu'à ce cas précis (vérifié empiriquement — voir le job_i4 de
 * pg-boss/src/plans.js) — les files `publishNow`/`retryFailed` de ce fichier
 * ont ce même singletonKey « inerte », sans conséquence là-bas parce que les
 * verrous applicatifs réels (statut PUBLISHING, claim par cible) empêchent
 * déjà un double envoi. Un balayage métriques n'a pas d'équivalent : deux
 * exécutions concurrentes ne corrompraient rien mais dupliqueraient l'appel
 * Graph API pour rien, donc `singletonSeconds` est ajouté ici pour que la
 * fenêtre de déduplication soit réelle plutôt qu'un simple champ ignoré.
 *
 * @returns {Promise<string|null>} identifiant du job, ou `null` si un
 *   balayage a déjà été demandé pour cette marque dans la même fenêtre.
 */
export function enqueueMetricsSync({ brandId, requestedBy }) {
  return send(
    QUEUES.syncSocialMetrics,
    { brandId, requestedBy },
    { singletonKey: `metrics-sync:${brandId}`, singletonSeconds: 60, retryLimit: 0 }
  );
}

/**
 * Analyse concurrentielle : synchronisation à la demande d'un concurrent
 * (POST /api/v1/competitors/:id/sync), sur la même file que la reprise
 * périodique du worker.
 *
 * Le job n'emporte que l'identifiant : le worker relit l'état du concurrent au
 * moment de l'exécution plutôt que de travailler sur une copie figée à
 * l'instant de la demande — un concurrent supprimé entre-temps ne doit pas être
 * synchronisé quand même.
 *
 * `singletonSeconds` accompagne `singletonKey` pour la même raison qu'avec
 * `enqueueMetricsSync` : sans lui, pg-boss 10 laisse la clé inerte et deux
 * demandes rapprochées appelleraient Meta deux fois pour rien.
 *
 * @returns {Promise<string|null>} identifiant du job, ou `null` si une
 *   synchronisation est déjà en attente pour ce concurrent.
 */
export function enqueueCompetitorSync({ competitorId, requestedBy }) {
  return send(
    QUEUES.syncCompetitor,
    { competitorId, requestedBy },
    { singletonKey: competitorSingletonKey(competitorId), singletonSeconds: 60, retryLimit: 0 }
  );
}

/**
 * Import des publications d'une page : à la liaison (synchronisation initiale) et à
 * la demande (bouton « Synchroniser »), sur la même file que le balayage périodique
 * du worker (services/worker/index.js).
 *
 * Le job n'emporte que l'identifiant du compte : initiale ou incrémentale se décide
 * côté graph-api d'après `last_posts_sync_at`, jamais d'après une copie figée dans
 * le job. `singletonSeconds` accompagne `singletonKey` pour la même raison qu'avec
 * `enqueueMetricsSync` : sans lui la clé est inerte et deux clics rapprochés
 * relanceraient tout le parcours du fil chez Meta.
 *
 * @returns {Promise<string|null>} identifiant du job, ou `null` si une
 *   synchronisation vient déjà d'être demandée pour ce compte.
 */
export function enqueuePostsSync({ socialAccountId, requestedBy }) {
  return send(
    QUEUES.syncSocialPosts,
    { socialAccountId, requestedBy },
    // Une passe initiale sur une grande page dépasse le quart d'heure par défaut
    // d'expiration de pg-boss : un job « expiré » serait relancé pendant qu'il tourne.
    { singletonKey: postsSyncSingletonKey(socialAccountId), singletonSeconds: 60, retryLimit: 0, expireInSeconds: 3600 }
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
