/**
 * Import des publications d'une page : synchronisation initiale à la liaison, puis
 * incrémentale.
 *
 * Même idiome que comment-sync.js et metrics-sync.js : le worker ne fait que
 * CHOISIR les comptes (lecture SQL de social_accounts) et appeler graph-api ; la
 * lecture chez Meta et l'écriture des publications sont faites par graph-api
 * (POST /internal/v1/posts/sync), qui est aussi seul écrivain de
 * `last_posts_sync_at`.
 *
 * Initiale ou incrémentale n'est PAS décidé ici : graph-api le déduit de
 * `last_posts_sync_at` (vide = tout l'historique, sinon la fenêtre récente). Ce
 * module n'a donc rien à garder en mémoire d'un job à l'autre — un compte dont
 * l'import initial a été interrompu est simplement repris de zéro au passage
 * suivant, sans état à réparer.
 *
 * Un appel à graph-api ne lit que quelques pages : tant que la réponse n'est pas
 * `done`, on rappelle avec son curseur.
 */

const SELECT_ACCOUNTS_DUE_FOR_SYNC = `
  SELECT id, provider
    FROM social_accounts
   WHERE provider = 'FACEBOOK'
     AND status IN ('CONNECTED', 'EXPIRING')
     AND (last_posts_sync_at IS NULL OR last_posts_sync_at < now() - make_interval(mins => $1::int))
   ORDER BY last_posts_sync_at NULLS FIRST
   LIMIT $2::int
`;

const SELECT_ACCOUNT_FOR_SYNC = `
  SELECT id, provider
    FROM social_accounts
   WHERE id = $1::uuid AND status IN ('CONNECTED', 'EXPIRING')
`;

// Instagram : graph-api refuse (pas encore de lecture de son fil). On ne l'appelle
// pas pour obtenir un 422 à chaque passage.
const SUPPORTED_PROVIDERS = ['FACEBOOK'];

export function createPostsSync({ query, syncPosts, logger = console }) {
  /**
   * Importe UN compte, appel après appel, jusqu'à la fin du fil.
   *
   * `maxCalls` borne la boucle (100 appels ≈ 15 000 posts avec les réglages par
   * défaut de graph-api) : une réponse `done: false` sans fin ne doit pas tenir le
   * worker indéfiniment. Au-delà, `done: false` est rendu et l'import n'est PAS noté
   * achevé — le passage suivant le reprend depuis le début.
   */
  async function syncAccount(account, { maxCalls = 100 } = {}) {
    const totals = { mode: null, created: 0, updated: 0, unchanged: 0, skipped: 0, calls: 0, done: false };
    let cursor = null;

    while (totals.calls < maxCalls) {
      const result = await syncPosts(account.id, account.provider, cursor);
      totals.calls += 1;
      totals.mode ??= result.mode;
      for (const key of ['created', 'updated', 'unchanged', 'skipped']) totals[key] += result[key] ?? 0;

      if (result.done) {
        totals.done = true;
        return totals;
      }
      cursor = result.nextCursor;
      // Une réponse inachevée sans curseur casse le contrat : reboucler sans
      // curseur relirait la première page à l'infini.
      if (!cursor) throw new Error('posts_sync_cursor_missing');
    }
    return totals;
  }

  /** Job ciblé : liaison d'une page, bouton « Synchroniser ». */
  async function syncOne(socialAccountId) {
    const [account] = await query(SELECT_ACCOUNT_FOR_SYNC, [socialAccountId]);
    // Compte supprimé, déconnecté ou à reconnecter depuis la demande : rien à faire,
    // et surtout pas d'erreur — le job n'a pas à être retenté.
    if (!account) return { socialAccountId, skipped: 'account_unavailable' };
    if (!SUPPORTED_PROVIDERS.includes(account.provider)) return { socialAccountId, skipped: 'provider_not_supported' };

    // Une erreur remonte : le job est marqué échoué, visible dans pg-boss. Elle est
    // rattrapée par le balayage tant que `last_posts_sync_at` n'est pas à jour.
    return { socialAccountId, ...(await syncAccount(account)) };
  }

  /**
   * Balayage périodique : les comptes jamais importés d'abord (NULLS FIRST), puis
   * ceux dont la dernière passe est ancienne. `limit` est volontairement bas : une
   * passe initiale sur une grande page dure plusieurs minutes, et le reste attend
   * simplement le prochain balayage.
   */
  async function sweep({ staleAfterMinutes = 20, limit = 5 } = {}) {
    const accounts = await query(SELECT_ACCOUNTS_DUE_FOR_SYNC, [staleAfterMinutes, limit]);

    let synced = 0;
    let incomplete = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        const result = await syncAccount(account);
        if (result.done) synced += 1;
        else incomplete += 1;
      } catch (error) {
        // Un compte en échec ne doit pas interrompre les autres — même
        // raisonnement que comment-sync.js et token-refresh.js.
        failed += 1;
        logger.warn?.({ scope: 'posts-sync', socialAccountId: account.id, error: error?.message });
      }
    }

    return { inspected: accounts.length, synced, incomplete, failed };
  }

  return { sweep, syncOne, syncAccount };
}
