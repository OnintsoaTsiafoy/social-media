/**
 * Rafraîchissement / revalidation des comptes sociaux connectés.
 *
 * Un token Page Facebook n'expire pas activement une fois émis (voir
 * graph-api/modules/oauth/account_service.py) : "rafraîchir" revient à le
 * revalider auprès de Meta pour détecter une révocation silencieuse. Une
 * seule requête couvre donc deux cas : un token qui expire réellement
 * bientôt (Instagram, Sprint 07) et un compte connecté jamais revérifié
 * depuis longtemps (Facebook aujourd'hui).
 */

const SELECT_ACCOUNTS_NEEDING_REFRESH = `
  SELECT sa.id
    FROM social_accounts sa
    LEFT JOIN oauth_tokens ot ON ot.social_account_id = sa.id AND ot.status = 'ACTIVE'
   WHERE sa.status IN ('CONNECTED', 'EXPIRING')
     AND (
       (ot.expires_at IS NOT NULL AND ot.expires_at < now() + make_interval(hours => $1::int))
       OR sa.updated_at < now() - make_interval(hours => $2::int)
     )
   ORDER BY sa.updated_at
   LIMIT $3::int
`;

export function createTokenRefresh({ query, refreshToken, logger = console }) {
  async function run({ expiringWithinHours = 24, staleAfterHours = 24, limit = 50 } = {}) {
    const accounts = await query(SELECT_ACCOUNTS_NEEDING_REFRESH, [
      expiringWithinHours,
      staleAfterHours,
      limit,
    ]);

    let refreshed = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        await refreshToken(account.id);
        refreshed += 1;
      } catch (error) {
        // graph-api already flags the account REAUTH_REQUIRED server-side on
        // a genuine failure — one bad account must not stop the batch.
        failed += 1;
        logger.warn?.({ scope: 'token-refresh', socialAccountId: account.id, error: error?.message });
      }
    }

    return { inspected: accounts.length, refreshed, failed };
  }

  return { run };
}
