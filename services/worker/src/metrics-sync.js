/**
 * Synchronisation périodique des métriques sociales (Sprint 12 Jour 2).
 *
 * Même idiome que comment-sync.js : le worker ne fait que LIRE
 * social_accounts/publication_targets en SQL direct pour choisir les
 * candidats — l'écriture réelle (persistance des relevés dans
 * social_metrics, last_metrics_sync_at) est faite par graph-api dans le même
 * appel /internal/v1/metrics/sync, pas par le worker.
 *
 * Contrairement aux commentaires, chaque identifiant demandé coûte un appel
 * Graph API séquentiel côté graph-api (un post = une requête /insights) : le
 * nombre de cibles par compte est plafonné (`targetsPerAccount`) pour borner
 * ce coût par exécution, et seuls les posts déjà envoyés (`status = 'SENT'`)
 * sont candidats — pas de relevé à faire tant qu'une publication n'est pas
 * partie.
 */

import { activeBrand } from './lib/active-brand.js';

const SELECT_ACCOUNTS_DUE_FOR_SYNC = `
  SELECT id, provider
    FROM social_accounts
   WHERE status IN ('CONNECTED', 'EXPIRING')
     AND (last_metrics_sync_at IS NULL OR last_metrics_sync_at < now() - make_interval(mins => $1::int))
     AND ${activeBrand('social_accounts.brand_id')}
   ORDER BY last_metrics_sync_at NULLS FIRST
   LIMIT $2::int
`;

// Pas de DISTINCT : PostgreSQL le refuse avec un ORDER BY sur une colonne absente du
// SELECT (« for SELECT DISTINCT, ORDER BY expressions must appear in select list »),
// et cette requête échouait donc pour chaque compte. Il est de toute façon inutile —
// (social_account_id, external_publication_id) est unique depuis l'import des
// publications d'une page.
const SELECT_TARGETS_DUE_FOR_METRICS_SYNC = `
  SELECT external_publication_id
    FROM publication_targets
   WHERE social_account_id = $1 AND status = 'SENT' AND external_publication_id IS NOT NULL
   ORDER BY sent_at DESC NULLS LAST
   LIMIT $2::int
`;

export function createMetricsSync({ query, syncMetrics, logger = console }) {
  async function run({ staleAfterMinutes = 60, accountLimit = 20, targetsPerAccount = 25 } = {}) {
    const accounts = await query(SELECT_ACCOUNTS_DUE_FOR_SYNC, [staleAfterMinutes, accountLimit]);

    let synced = 0;
    let skipped = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        const rows = await query(SELECT_TARGETS_DUE_FOR_METRICS_SYNC, [account.id, targetsPerAccount]);
        const publicationExternalIds = rows.map((row) => row.external_publication_id);
        if (publicationExternalIds.length === 0) {
          // Rien d'envoyé pour ce compte — aucun post à relever.
          skipped += 1;
          continue;
        }
        await syncMetrics(account.id, account.provider, publicationExternalIds);
        synced += 1;
      } catch (error) {
        // Un compte en échec ne doit pas interrompre la synchronisation des
        // autres — même raisonnement que comment-sync.js/token-refresh.js.
        failed += 1;
        logger.warn?.({ scope: 'metrics-sync', socialAccountId: account.id, error: error?.message });
      }
    }

    return { inspected: accounts.length, synced, skipped, failed };
  }

  return { run };
}
