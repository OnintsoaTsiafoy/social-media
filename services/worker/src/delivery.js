/**
 * Exécution d'une publication vers ses réseaux.
 *
 * Toutes les dépendances sont injectées (accès SQL, connecteur social, horloge,
 * planification des retries) : la logique est testable sans PostgreSQL ni file
 * de travaux.
 *
 * Garanties visées par le Sprint 04 :
 * - une cible n'est jamais envoyée deux fois (verrou conditionnel + clé
 *   d'idempotence par tentative) ;
 * - un job rejoué après un redémarrage reprend sans doublon ;
 * - le statut global est toujours déduit de l'état réel des cibles.
 */

import {
  MAX_DELIVERY_ATTEMPTS,
  computePublicationStatus,
  retryDelaySeconds,
  selectDeliverableTargets,
} from '../../shared/publication-status.js';
import { composeContent, deliver as defaultDeliver } from '../../shared/social-provider.js';

const CLAIM_PUBLICATION = `
  UPDATE publications
     SET status = 'PUBLISHING', updated_at = now()
   WHERE id = $1::uuid
     AND deleted_at IS NULL
     AND status IN ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'FAILED', 'PARTIALLY_PUBLISHED')
  RETURNING id, brand_id, content, hashtags, language, timezone
`;

const SELECT_TARGETS = `
  SELECT id, provider, status, adapted_content, adapted_hashtags, attempt_count
    FROM publication_targets
   WHERE publication_id = $1::uuid
   ORDER BY provider
`;

const CLAIM_TARGET = `
  UPDATE publication_targets
     SET status = 'SENDING', updated_at = now()
   WHERE id = $1::uuid
     AND status IN ('PENDING', 'FAILED')
  RETURNING attempt_count
`;

const INSERT_ATTEMPT = `
  INSERT INTO publication_delivery_attempts (publication_target_id, attempt_number, idempotency_key, status)
  VALUES ($1::uuid, $2::int, $3, 'STARTED')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id
`;

const FINISH_ATTEMPT_OK = `
  UPDATE publication_delivery_attempts
     SET status = 'SUCCEEDED', external_publication_id = $2, finished_at = now()
   WHERE id = $1::uuid
`;

const FINISH_ATTEMPT_KO = `
  UPDATE publication_delivery_attempts
     SET status = 'FAILED', error_code = $2, error_message = $3, finished_at = now()
   WHERE id = $1::uuid
`;

const MARK_TARGET_SENT = `
  UPDATE publication_targets
     SET status = 'SENT', external_publication_id = $2, attempt_count = $3::int, sent_at = now(),
         last_error_code = NULL, last_error_message = NULL, updated_at = now()
   WHERE id = $1::uuid
`;

const MARK_TARGET_FAILED = `
  UPDATE publication_targets
     SET status = 'FAILED', attempt_count = $2::int, last_error_code = $3, last_error_message = $4, updated_at = now()
   WHERE id = $1::uuid
`;

const SELECT_TARGET_STATUSES = `SELECT status FROM publication_targets WHERE publication_id = $1::uuid`;

const UPDATE_PUBLICATION_STATUS = `
  UPDATE publications
     SET status = $2::"PublicationStatus",
         published_at = CASE WHEN $3::boolean AND published_at IS NULL THEN now() ELSE published_at END,
         updated_at = now()
   WHERE id = $1::uuid
`;

const SELECT_SCHEDULE = `SELECT status FROM scheduled_publications WHERE publication_id = $1::uuid`;

const MARK_SCHEDULE_DISPATCHED = `
  UPDATE scheduled_publications
     SET status = 'DISPATCHED', job_id = NULL, updated_at = now()
   WHERE publication_id = $1::uuid AND status = 'PENDING'
`;

function attemptIdempotencyKey(publicationId, provider, attemptNumber) {
  return `${publicationId}:${provider}:${attemptNumber}`;
}

export function createDeliveryService({
  query,
  provider = { deliver: defaultDeliver },
  scheduleRetry = async () => null,
  logger = console,
}) {
  async function deliverTarget(publication, target) {
    // Verrou conditionnel : si la cible n'est plus livrable (déjà envoyée ou
    // prise par un autre worker), on ne l'envoie pas.
    const [claimed] = await query(CLAIM_TARGET, [target.id]);
    if (!claimed) return { provider: target.provider, skipped: 'already_handled' };

    const attemptNumber = Number(claimed.attempt_count) + 1;
    const idempotencyKey = attemptIdempotencyKey(publication.id, target.provider, attemptNumber);

    // Deuxième garde-fou : la tentative n'existe qu'une fois, même si le job
    // est rejoué après un redémarrage brutal.
    const [attempt] = await query(INSERT_ATTEMPT, [target.id, attemptNumber, idempotencyKey]);
    if (!attempt) return { provider: target.provider, skipped: 'attempt_already_recorded' };

    const content = composeContent(publication, {
      adaptedContent: target.adapted_content,
      adaptedHashtags: target.adapted_hashtags,
    });

    try {
      const result = await provider.deliver({
        publicationId: publication.id,
        provider: target.provider,
        content,
        attemptNumber,
      });

      await query(FINISH_ATTEMPT_OK, [attempt.id, result.externalPublicationId]);
      await query(MARK_TARGET_SENT, [target.id, result.externalPublicationId, attemptNumber]);
      return { provider: target.provider, status: 'SENT', attemptNumber };
    } catch (error) {
      const code = error?.code ?? 'provider_unavailable';
      const message = error?.message ?? 'Envoi impossible.';
      await query(FINISH_ATTEMPT_KO, [attempt.id, code, message]);
      await query(MARK_TARGET_FAILED, [target.id, attemptNumber, code, message]);

      return {
        provider: target.provider,
        status: 'FAILED',
        attemptNumber,
        errorCode: code,
        // Seule une erreur temporaire est rejouée automatiquement ; un refus de
        // contenu attend une correction humaine.
        retryable: Boolean(error?.retryable) && attemptNumber < MAX_DELIVERY_ATTEMPTS,
      };
    }
  }

  async function refreshPublicationStatus(publicationId) {
    const rows = await query(SELECT_TARGET_STATUSES, [publicationId]);
    const status = computePublicationStatus(rows.map((row) => ({ status: row.status })));
    const isPublished = status === 'PUBLISHED' || status === 'PARTIALLY_PUBLISHED';
    await query(UPDATE_PUBLICATION_STATUS, [publicationId, status, isPublished]);
    return status;
  }

  /**
   * @param {{ publicationId: string, providers?: string[], requireSchedule?: boolean, requestedBy?: string }} command
   */
  async function publish(command) {
    const { publicationId, providers, requireSchedule = false, requestedBy } = command;

    if (requireSchedule) {
      const [schedule] = await query(SELECT_SCHEDULE, [publicationId]);
      // Une planification annulée entre-temps ne doit rien envoyer.
      if (!schedule || schedule.status !== 'PENDING') {
        return { publicationId, skipped: 'schedule_not_pending' };
      }
    }

    const [publication] = await query(CLAIM_PUBLICATION, [publicationId]);
    if (!publication) return { publicationId, skipped: 'not_publishable' };

    const context = {
      id: publication.id,
      content: publication.content,
      hashtags: Array.isArray(publication.hashtags) ? publication.hashtags : [],
    };

    const rows = await query(SELECT_TARGETS, [publicationId]);
    const targets = selectDeliverableTargets(rows, providers);

    const results = [];
    for (const target of targets) {
      results.push(await deliverTarget(context, target));
    }

    const status = await refreshPublicationStatus(publicationId);
    await query(MARK_SCHEDULE_DISPATCHED, [publicationId]);

    // Retries automatiques : uniquement les erreurs temporaires, avec le
    // backoff 1 min / 5 min / 15 min / 1 h.
    const retryable = results.filter((result) => result.retryable);
    const retries = [];
    for (const result of retryable) {
      const delaySeconds = retryDelaySeconds(result.attemptNumber);
      const jobId = await scheduleRetry({
        publicationId,
        providers: [result.provider],
        attempt: result.attemptNumber + 1,
        requestedBy,
        delaySeconds,
      });
      retries.push({ provider: result.provider, delaySeconds, jobId });
    }

    logger.log?.({ scope: 'delivery', publicationId, status, results, retries });
    return { publicationId, status, results, retries };
  }

  return { publish, refreshPublicationStatus };
}
