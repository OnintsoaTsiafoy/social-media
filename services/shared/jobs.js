/** Noms de files pg-boss partagés entre le producteur (API) et le worker. */

export const QUEUES = {
  publishScheduled: 'publish-scheduled-publication',
  publishNow: 'publish-publication-now',
  retryFailed: 'retry-failed-publication',
  cleanupTemporaryMedia: 'cleanup-temporary-media',
  refreshExpiringTokens: 'refresh-expiring-oauth-tokens',
};

export const ALL_QUEUES = Object.values(QUEUES);

/** Une seule exécution simultanée par publication, quelle que soit la file. */
export function singletonKeyFor(publicationId) {
  return `publication:${publicationId}`;
}
