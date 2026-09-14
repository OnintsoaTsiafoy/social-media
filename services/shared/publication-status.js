/**
 * Statuts de publication et règles de transition.
 *
 * Module pur, sans dépendance : il est importé à la fois par l'API Express et
 * par le worker, qui doivent calculer le statut global exactement de la même
 * façon. Toute dépendance externe ajoutée ici casserait la résolution de
 * modules du worker (voir services/shared/README.md).
 */

export const PUBLICATION_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SCHEDULED: 'SCHEDULED',
  PUBLISHING: 'PUBLISHING',
  PUBLISHED: 'PUBLISHED',
  PARTIALLY_PUBLISHED: 'PARTIALLY_PUBLISHED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

export const TARGET_STATUS = {
  PENDING: 'PENDING',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
};

export const ATTEMPT_STATUS = {
  STARTED: 'STARTED',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
};

export const PROVIDERS = ['FACEBOOK', 'INSTAGRAM'];

/** Transitions autorisées ; toute autre combinaison est un `409 conflict`. */
const ALLOWED_TRANSITIONS = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT'],
  APPROVED: ['DRAFT', 'SCHEDULED', 'PUBLISHING', 'CANCELLED'],
  REJECTED: ['DRAFT'],
  SCHEDULED: ['DRAFT', 'APPROVED', 'PUBLISHING', 'CANCELLED'],
  PUBLISHING: ['PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED'],
  PUBLISHED: [],
  PARTIALLY_PUBLISHED: ['PUBLISHING'],
  FAILED: ['PUBLISHING', 'SCHEDULED', 'DRAFT', 'CANCELLED'],
  CANCELLED: ['DRAFT'],
};

export function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Statuts depuis lesquels le contenu reste modifiable. */
export function canEditContent(status) {
  return ['DRAFT', 'APPROVED', 'REJECTED', 'SCHEDULED', 'FAILED', 'CANCELLED'].includes(status);
}

/** Une publication en cours d'envoi ne peut pas être supprimée sous le worker. */
export function canDelete(status) {
  return status !== 'PUBLISHING' && status !== 'PENDING_APPROVAL';
}

export function canSchedule(status) {
  return ['APPROVED', 'SCHEDULED', 'FAILED'].includes(status);
}

/** Une publication déjà envoyée ne peut pas repartir ; un échec partiel, si. */
export function canPublish(status) {
  return ['APPROVED', 'SCHEDULED', 'FAILED', 'PARTIALLY_PUBLISHED'].includes(status);
}

export function hasValidApproval(publication) {
  return Number.isInteger(publication.contentRevision) &&
    publication.approvedRevision === publication.contentRevision &&
    publication.approvals?.some((approval) =>
      approval.status === 'APPROVED' && approval.revision === publication.contentRevision
    ) === true;
}

/**
 * Statut global déduit des cibles.
 *
 * La règle est volontairement stricte : tant qu'une cible n'est pas retombée
 * sur un état terminal, la publication reste `PUBLISHING`, afin que l'écran
 * mobile n'annonce jamais un envoi terminé alors qu'un réseau est encore
 * en cours.
 */
export function computePublicationStatus(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return PUBLICATION_STATUS.DRAFT;

  const statuses = targets.map((target) => target.status);
  if (statuses.some((status) => status === TARGET_STATUS.SENDING || status === TARGET_STATUS.PENDING)) {
    return PUBLICATION_STATUS.PUBLISHING;
  }
  if (statuses.every((status) => status === TARGET_STATUS.SENT)) return PUBLICATION_STATUS.PUBLISHED;
  if (statuses.every((status) => status === TARGET_STATUS.FAILED)) return PUBLICATION_STATUS.FAILED;
  return PUBLICATION_STATUS.PARTIALLY_PUBLISHED;
}

/**
 * Cibles à (ré)envoyer.
 *
 * `providers` limite la sélection à un réseau : c'est le retry ciblé exigé par
 * l'écran de détail. Une cible déjà `SENT` n'est jamais resélectionnée, sinon
 * un même contenu partirait deux fois sur le réseau.
 */
export function selectDeliverableTargets(targets, providers) {
  const wanted = providers?.length ? providers.map((provider) => provider.toUpperCase()) : undefined;
  return targets.filter((target) => {
    if (target.status === TARGET_STATUS.SENT) return false;
    if (wanted && !wanted.includes(target.provider)) return false;
    return true;
  });
}

/** Backoff imposé par le Sprint 04 : 1 min, 5 min, 15 min puis 1 h. */
export const RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600];

export function retryDelaySeconds(attemptNumber) {
  const index = Math.max(0, Math.min(attemptNumber - 1, RETRY_BACKOFF_SECONDS.length - 1));
  return RETRY_BACKOFF_SECONDS[index];
}

export const MAX_DELIVERY_ATTEMPTS = RETRY_BACKOFF_SECONDS.length + 1;
