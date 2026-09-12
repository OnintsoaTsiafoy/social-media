/**
 * Synchronisation de secours des commentaires (Sprint 08 Jour 3).
 *
 * Même idiome que token-refresh.js : le worker ne fait que LIRE
 * social_accounts/publication_targets en SQL direct pour choisir les
 * candidats — l'écriture réelle (persistance des commentaires,
 * last_comments_sync_at) est faite par graph-api dans le même appel
 * /internal/v1/comments/sync, pas par le worker.
 *
 * Filet de secours pour les webhooks manqués, mais seulement pour les posts
 * publiés par Hootly : rien n'énumère les posts organiques d'une Page (pas
 * d'appel à /{page-id}/feed dans ce sprint), donc un commentaire sur un post
 * organique jamais reçu par webhook n'a aucun rattrapage ici — limite
 * documentée, pas cachée.
 */

const SELECT_ACCOUNTS_DUE_FOR_SYNC = `
  SELECT id, provider
    FROM social_accounts
   WHERE status IN ('CONNECTED', 'EXPIRING')
     AND (last_comments_sync_at IS NULL OR last_comments_sync_at < now() - make_interval(mins => $1::int))
   ORDER BY last_comments_sync_at NULLS FIRST
   LIMIT $2::int
`;

const SELECT_PUBLISHED_EXTERNAL_IDS = `
  SELECT DISTINCT external_publication_id
    FROM publication_targets
   WHERE social_account_id = $1 AND external_publication_id IS NOT NULL
`;

export function createCommentSync({ query, syncComments, logger = console }) {
  async function run({ staleAfterMinutes = 15, limit = 50 } = {}) {
    const accounts = await query(SELECT_ACCOUNTS_DUE_FOR_SYNC, [staleAfterMinutes, limit]);

    let synced = 0;
    let skipped = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        const rows = await query(SELECT_PUBLISHED_EXTERNAL_IDS, [account.id]);
        const publicationExternalIds = rows.map((row) => row.external_publication_id);
        if (publicationExternalIds.length === 0) {
          // Rien publié par Hootly pour ce compte — pas de post à revérifier.
          skipped += 1;
          continue;
        }
        await syncComments(account.id, account.provider, publicationExternalIds);
        synced += 1;
      } catch (error) {
        // Un compte en échec ne doit pas interrompre la synchronisation des
        // autres — même raisonnement que token-refresh.js.
        failed += 1;
        logger.warn?.({ scope: 'comment-sync', socialAccountId: account.id, error: error?.message });
      }
    }

    return { inspected: accounts.length, synced, skipped, failed };
  }

  return { run };
}
