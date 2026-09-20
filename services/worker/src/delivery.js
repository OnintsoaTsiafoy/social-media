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
import { ProviderError, composeContent, deliver as defaultDeliver } from '../../shared/social-provider.js';

const CLAIM_PUBLICATION = `
  UPDATE publications
     SET status = 'PUBLISHING', updated_at = now()
   WHERE id = $1::uuid
     AND deleted_at IS NULL
     AND status IN ('APPROVED', 'SCHEDULED', 'PUBLISHING', 'FAILED', 'PARTIALLY_PUBLISHED')
     AND content_revision = $2::int AND approved_revision = content_revision
     AND (NOT $3::boolean OR (status IN ('SCHEDULED', 'PUBLISHING')
          AND scheduled_at = COALESCE($4::timestamptz, scheduled_at)))
     AND EXISTS (SELECT 1 FROM publication_approvals a WHERE a.publication_id = publications.id
                 AND a.revision = publications.content_revision AND a.status = 'APPROVED')
  RETURNING id, brand_id, content, hashtags, language, timezone, created_by_user_id, content_revision
`;

const CHECK_APPROVAL = `
  SELECT p.status, p.content_revision, p.approved_revision,
         EXISTS (SELECT 1 FROM publication_approvals a WHERE a.publication_id = p.id
                 AND a.revision = p.content_revision AND a.status = 'APPROVED') AS approval_valid
    FROM publications p WHERE p.id = $1::uuid AND p.deleted_at IS NULL
`;

const CANCEL_INVALID_SCHEDULE = `
  UPDATE scheduled_publications SET status = 'CANCELLED', job_id = NULL, updated_at = now()
   WHERE publication_id = $1::uuid AND status = 'PENDING'
     AND NOT EXISTS (SELECT 1 FROM publications p JOIN publication_approvals a ON a.publication_id = p.id
       WHERE p.id = $1::uuid AND p.deleted_at IS NULL AND a.status = 'APPROVED'
         AND p.approved_revision = p.content_revision AND a.revision = p.content_revision)
`;

const AUDIT_SKIPPED_JOB = `
  INSERT INTO audit_logs (id, action, resource_type, resource_id, metadata, created_at)
  VALUES (gen_random_uuid(), 'publication.job_cancelled', 'publication', $1, $2::jsonb, now())
`;

const AUDIT_DELIVERY = `
  INSERT INTO audit_logs (id, action, resource_type, resource_id, metadata, created_at)
  VALUES (gen_random_uuid(), 'publication.delivery_completed', 'publication', $1, $2::jsonb, now())
`;

const SELECT_TARGETS = `
  SELECT id, provider, social_account_id, status, adapted_content, adapted_hashtags, attempt_count
    FROM publication_targets
   WHERE publication_id = $1::uuid
   ORDER BY provider
`;

// One image per publication (ADR-08's MVP scope), shared across every
// target — a per-network media override doesn't exist yet.
const SELECT_PUBLICATION_MEDIA = `
  SELECT m.bucket, m.object_key
    FROM publication_media pm
    JOIN media m ON m.id = pm.media_id
   WHERE pm.publication_id = $1::uuid
   ORDER BY pm.position
`;

// Une cible garde le compte résolu à sa création, or celui-ci peut alors être
// indisponible (jeton à reconnecter) puis rétabli avant l'envoi. Sans compte,
// graph-api retomberait sur la « page globale » du .env (héritage Sprint 05,
// factice en local) et Meta refuserait la publication.
const SELECT_BRAND_ACCOUNTS = `SELECT id, name, status FROM social_accounts WHERE brand_id = $1::uuid AND provider = $2`;

const SET_TARGET_ACCOUNT = `
  UPDATE publication_targets SET social_account_id = $2::uuid, updated_at = now()
   WHERE id = $1::uuid AND social_account_id IS NULL
`;

const USABLE_ACCOUNT_STATUSES = ['CONNECTED', 'EXPIRING'];
const RECONNECT_ACCOUNT_STATUSES = ['EXPIRED', 'REAUTH_REQUIRED', 'REVOKED'];
const NETWORK_LABELS = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram' };

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

const SELECT_SCHEDULE = `SELECT status, scheduled_at FROM scheduled_publications WHERE publication_id = $1::uuid`;

const MARK_SCHEDULE_DISPATCHED = `
  UPDATE scheduled_publications
     SET status = 'DISPATCHED', job_id = NULL, updated_at = now()
   WHERE publication_id = $1::uuid AND status = 'PENDING'
`;

function attemptIdempotencyKey(publicationId, provider, attemptNumber) {
  return `${publicationId}:${provider}:${attemptNumber}`;
}

// Sprint 11 Jour 3. Un statut par publication, une seule fois : l'eventId
// (`publication:{id}:{status}`) n'inclut pas la tentative, donc une relance
// automatique qui échoue à nouveau dans le MÊME statut ne re-notifie pas —
// choix délibéré pour ne pas pousser une alerte à chaque retry d'un backoff
// déjà en cours (voir retryDelaySeconds). DRAFT/SCHEDULED/PUBLISHING/
// CANCELLED ne sont pas des états terminaux dignes d'une notification.
const PUBLICATION_NOTIFICATION_TYPE = {
  PUBLISHED: 'PUBLICATION_PUBLISHED',
  FAILED: 'PUBLICATION_FAILED',
  PARTIALLY_PUBLISHED: 'PUBLICATION_PARTIAL',
};

const PUBLICATION_NOTIFICATION_TITLE = {
  PUBLISHED: 'Publication publiée',
  FAILED: 'Publication échouée',
  PARTIALLY_PUBLISHED: 'Publication partiellement publiée',
};

function contentSnippet(content) {
  const text = (content ?? '').trim();
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function publicationNotificationMessage(status, content) {
  const snippet = contentSnippet(content);
  if (status === 'PUBLISHED') return `« ${snippet} » a été publiée avec succès.`;
  if (status === 'FAILED') return `« ${snippet} » n’a pas pu être publiée.`;
  return `« ${snippet} » a été publiée sur certains réseaux seulement.`;
}

export function createDeliveryService({
  query,
  provider = { deliver: defaultDeliver },
  scheduleRetry = async () => null,
  // Sprint 07: signs the publication's media for a provider that actually
  // calls Meta (graph-api needs a URL it can fetch, not a storage key). The
  // mock ignores mediaUrls entirely, so tests can omit this dependency.
  signMedia = async () => null,
  // Sprint 11 Jour 3: notifie l'auteur de la publication (pas toute la
  // marque — c'est SA publication) une fois le statut agrégé recalculé.
  // Optionnel comme `notifyUser` de comment-analysis.js : les tests
  // existants qui l'omettent ne doivent pas se mettre à échouer.
  notifyUser,
  logger = console,
}) {
  async function approvalIsCurrent(publicationId, revision) {
    const [row] = await query(CHECK_APPROVAL, [publicationId]);
    return row && Number.isInteger(revision) && row.content_revision === revision &&
      row.approved_revision === revision && row.approval_valid;
  }

  async function cancelInvalidJob(publicationId, reason) {
    await query(CANCEL_INVALID_SCHEDULE, [publicationId]);
    await query(AUDIT_SKIPPED_JOB, [publicationId, JSON.stringify({ reason })]);
    logger.warn?.({ scope: 'delivery', publicationId, skipped: reason });
    return { publicationId, skipped: reason };
  }

  /**
   * Compte social à utiliser pour une cible. Seul un connecteur qui appelle
   * vraiment un réseau (`requiresSocialAccount`) en a besoin : le mock livre
   * sans compte. Retrouve l'unique compte utilisable de la marque et le
   * mémorise sur la cible ; sinon refuse avec un message exploitable, affiché
   * tel quel dans l'application, plutôt que d'appeler Meta pour rien.
   */
  async function resolveSocialAccountId(publication, target) {
    if (target.social_account_id || !provider.requiresSocialAccount) return target.social_account_id ?? null;

    const network = NETWORK_LABELS[target.provider] ?? target.provider;
    const accounts = await query(SELECT_BRAND_ACCOUNTS, [publication.brandId, target.provider]);
    const usable = accounts.filter((account) => USABLE_ACCOUNT_STATUSES.includes(account.status));

    if (usable.length === 1) {
      await query(SET_TARGET_ACCOUNT, [target.id, usable[0].id]);
      return usable[0].id;
    }
    if (usable.length > 1) {
      throw new ProviderError(
        'validation_failed',
        `Plusieurs comptes ${network} sont connectés à cette marque et aucun n’a été choisi pour cette publication.`,
      );
    }
    const expired = accounts.find((account) => RECONNECT_ACCOUNT_STATUSES.includes(account.status));
    if (expired) {
      throw new ProviderError(
        'token_expired',
        `Le compte ${network} « ${expired.name} » doit être reconnecté par un administrateur de la plateforme avant l’envoi.`,
      );
    }
    throw new ProviderError(
      'validation_failed',
      `Aucun compte ${network} n’est connecté à cette marque. Un administrateur de la plateforme doit en lier un.`,
    );
  }

  async function deliverTarget(publication, target, mediaUrls) {
    if (!await approvalIsCurrent(publication.id, publication.revision)) {
      await cancelInvalidJob(publication.id, 'approval_invalid');
      return { provider: target.provider, skipped: 'approval_invalid' };
    }
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
      const socialAccountId = await resolveSocialAccountId(publication, target);
      const result = await provider.deliver({
        publicationId: publication.id,
        publicationTargetId: target.id,
        socialAccountId,
        provider: target.provider,
        content,
        attemptNumber,
        mediaUrls: mediaUrls ?? [],
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
    const { publicationId, providers, requireSchedule = false, requestedBy, revision, scheduledAt } = command;

    if (!await approvalIsCurrent(publicationId, revision)) {
      return cancelInvalidJob(publicationId, 'approval_invalid_or_stale_job');
    }

    if (requireSchedule) {
      const [schedule] = await query(SELECT_SCHEDULE, [publicationId]);
      // Une planification annulée entre-temps ne doit rien envoyer.
      if (!schedule || schedule.status !== 'PENDING' ||
          (scheduledAt && new Date(schedule.scheduled_at).getTime() !== new Date(scheduledAt).getTime())) {
        return { publicationId, skipped: 'schedule_not_pending' };
      }
    }

    const [publication] = await query(CLAIM_PUBLICATION, [publicationId, revision, requireSchedule, scheduledAt ?? null]);
    if (!publication) return { publicationId, skipped: 'not_publishable' };

    const context = {
      id: publication.id,
      brandId: publication.brand_id,
      revision,
      content: publication.content,
      hashtags: Array.isArray(publication.hashtags) ? publication.hashtags : [],
    };

    const rows = await query(SELECT_TARGETS, [publicationId]);
    const targets = selectDeliverableTargets(rows, providers);

    const mediaRows = await query(SELECT_PUBLICATION_MEDIA, [publicationId]);
    const mediaUrls = [];
    for (const media of mediaRows) {
      const signed = await signMedia(media.bucket, media.object_key);
      if (signed?.url) mediaUrls.push(signed.url);
    }

    const results = [];
    for (const target of targets) {
      results.push(await deliverTarget(context, target, mediaUrls));
    }

    if (results.some((result) => result.skipped === 'approval_invalid')) {
      return { publicationId, skipped: 'approval_invalid', results };
    }

    const status = await refreshPublicationStatus(publicationId);
    await query(MARK_SCHEDULE_DISPATCHED, [publicationId]);
    await query(AUDIT_DELIVERY, [publicationId, JSON.stringify({ fromStatus: 'PUBLISHING', toStatus: status })]);

    const notificationType = PUBLICATION_NOTIFICATION_TYPE[status];
    if (notifyUser && notificationType) {
      try {
        await notifyUser({
          userId: publication.created_by_user_id,
          brandId: publication.brand_id,
          type: notificationType,
          priority: status === 'PUBLISHED' ? 'LOW' : 'HIGH',
          title: PUBLICATION_NOTIFICATION_TITLE[status],
          message: publicationNotificationMessage(status, publication.content),
          resourceType: 'PUBLICATION',
          resourceId: publicationId,
          eventId: `publication:${publicationId}:${status}`,
        });
      } catch (error) {
        // Ne doit jamais faire échouer la publication elle-même, déjà
        // livrée (ou non) indépendamment de la notification.
        logger.warn?.({ scope: 'delivery', action: 'notify', publicationId, error: error?.message });
      }
    }

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
        revision,
        delaySeconds,
      });
      retries.push({ provider: result.provider, delaySeconds, jobId });
    }

    logger.log?.({ scope: 'delivery', publicationId, status, results, retries });
    return { publicationId, status, results, retries };
  }

  return { publish, refreshPublicationStatus };
}
