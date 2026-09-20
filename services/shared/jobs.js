/** Noms de files pg-boss partagés entre le producteur (API) et le worker. */

export const QUEUES = {
  publishScheduled: 'publish-scheduled-publication',
  publishNow: 'publish-publication-now',
  retryFailed: 'retry-failed-publication',
  cleanupTemporaryMedia: 'cleanup-temporary-media',
  refreshExpiringTokens: 'refresh-expiring-oauth-tokens',
  syncSocialComments: 'sync-social-comments',
  analyzeSocialComments: 'analyze-social-comments',
  syncSocialMetrics: 'sync-social-metrics',
  // Import des publications d'une page : initiale à la liaison, puis incrémentale.
  syncSocialPosts: 'sync-social-posts',
  // Analyse concurrentielle : trois files distinctes plutôt qu'une seule, pour
  // que le profil (un appel Meta) ne soit pas retenté avec les publications
  // (jusqu'à quatre pages) quand seule la seconde étape a échoué.
  syncCompetitor: 'sync-competitor',
  syncCompetitorPosts: 'sync-competitor-posts',
  syncCompetitorMetrics: 'sync-competitor-metrics',
};

export const ALL_QUEUES = Object.values(QUEUES);

/** Une seule exécution simultanée par publication, quelle que soit la file. */
export function singletonKeyFor(publicationId) {
  return `publication:${publicationId}`;
}

/** Une seule synchronisation des publications à la fois par compte social. */
export function postsSyncSingletonKey(socialAccountId) {
  return `posts-sync:${socialAccountId}`;
}

/** Une seule exécution simultanée par concurrent, quelle que soit l'étape. */
export function competitorSingletonKey(competitorId) {
  return `competitor:${competitorId}`;
}
