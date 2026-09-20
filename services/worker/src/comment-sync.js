/**
 * Synchronisation de secours des commentaires (Sprint 08 Jour 3).
 *
 * Même idiome que token-refresh.js : le worker ne fait que LIRE
 * social_accounts/publication_targets en SQL direct pour choisir les
 * candidats — l'écriture réelle (persistance des commentaires,
 * last_comments_sync_at) est faite par graph-api dans le même appel
 * /internal/v1/comments/sync, pas par le worker.
 *
 * Filet de secours pour les webhooks manqués. Il couvre les posts connus de
 * Hootly : ceux qu'il a publiés, et depuis l'import des publications d'une page
 * (posts-sync.js) ceux qui existaient déjà sur la page. Seuls les plus récents
 * sont relus (`postsPerAccount`) : graph-api parcourt chaque post l'un après
 * l'autre, et l'historique importé en compte des centaines — les relire tous
 * toutes les 15 minutes épuiserait le quota Meta et dépasserait le délai d'attente.
 * Les commentaires d'un post ancien ne sont donc pas rattrapés ici (le webhook
 * reste leur voie normale) : limite documentée, pas cachée.
 */

import { activeBrand } from './lib/active-brand.js';

const SELECT_ACCOUNTS_DUE_FOR_SYNC = `
  SELECT id, provider
    FROM social_accounts
   WHERE status IN ('CONNECTED', 'EXPIRING')
     AND (last_comments_sync_at IS NULL OR last_comments_sync_at < now() - make_interval(mins => $1::int))
     AND ${activeBrand('social_accounts.brand_id')}
   ORDER BY last_comments_sync_at NULLS FIRST
   LIMIT $2::int
`;

// Les plus récents d'abord. Pas de DISTINCT (voir metrics-sync.js : refusé avec cet
// ORDER BY, et inutile grâce à l'unicité de (compte, identifiant externe)).
const SELECT_PUBLISHED_EXTERNAL_IDS = `
  SELECT external_publication_id
    FROM publication_targets
   WHERE social_account_id = $1 AND external_publication_id IS NOT NULL
   ORDER BY sent_at DESC NULLS LAST
   LIMIT $2::int
`;

export function createCommentSync({ query, syncComments, logger = console }) {
  async function run({ staleAfterMinutes = 15, limit = 50, postsPerAccount = 50 } = {}) {
    const accounts = await query(SELECT_ACCOUNTS_DUE_FOR_SYNC, [staleAfterMinutes, limit]);

    let synced = 0;
    let skipped = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        const rows = await query(SELECT_PUBLISHED_EXTERNAL_IDS, [account.id, postsPerAccount]);
        const publicationExternalIds = rows.map((row) => row.external_publication_id);
        if (publicationExternalIds.length === 0) {
          // Aucun post connu de Hootly pour ce compte — rien à revérifier.
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
