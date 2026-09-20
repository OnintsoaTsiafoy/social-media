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

import { activeBrand } from './lib/active-brand.js';

const SELECT_ACCOUNTS_NEEDING_REFRESH = `
  SELECT sa.id, sa.status, sa.brand_id, sa.connected_by_user_id, sa.provider, sa.name
    FROM social_accounts sa
    LEFT JOIN oauth_tokens ot ON ot.social_account_id = sa.id AND ot.status = 'ACTIVE'
   WHERE sa.status IN ('CONNECTED', 'EXPIRING')
     AND (
       (ot.expires_at IS NOT NULL AND ot.expires_at < now() + make_interval(hours => $1::int))
       OR sa.updated_at < now() - make_interval(hours => $2::int)
     )
     AND ${activeBrand('sa.brand_id')}
   ORDER BY sa.updated_at
   LIMIT $3::int
`;

const SELECT_ACCOUNT_STATUS = `SELECT status FROM social_accounts WHERE id = $1::uuid`;

// Sprint 11 Jour 3. Seules les DÉGRADATIONS déclenchent une notification —
// jamais un retour à CONNECTED (pas demandé par le sprint) ni un statut
// inchangé (le balayage tourne quotidiennement ; re-notifier chaque jour
// pour le même problème non résolu serait du bruit, pas une alerte). Ni
// « expiré » ni « ré-authentification requise » n'ont leur propre bascule
// côté mobile (voir NotificationPreferences) : les deux se résolvent de la
// même façon (reconnecter le compte), donc le même type suffit.
const DEGRADED_STATUS_TYPE = {
  EXPIRING: 'TOKEN_EXPIRING',
  EXPIRED: 'TOKEN_EXPIRED',
  REAUTH_REQUIRED: 'TOKEN_EXPIRED',
  REVOKED: 'ACCOUNT_DISCONNECTED',
};

const TOKEN_NOTIFICATION_TITLES = {
  TOKEN_EXPIRING: 'Connexion bientôt expirée',
  TOKEN_EXPIRED: 'Connexion expirée',
  ACCOUNT_DISCONNECTED: 'Compte déconnecté',
};

function networkLabel(provider) {
  if (provider === 'FACEBOOK') return 'Facebook';
  if (provider === 'INSTAGRAM') return 'Instagram';
  return provider;
}

function tokenNotificationMessage(type, accountName, provider) {
  const label = accountName ?? 'ce compte';
  const network = networkLabel(provider);
  if (type === 'TOKEN_EXPIRING') return `La connexion ${network} de ${label} va bientôt expirer.`;
  if (type === 'TOKEN_EXPIRED') return `Reconnectez ${label} pour reprendre les envois sur ${network}.`;
  return `${label} a été déconnecté sur ${network}. Reconnectez-le pour continuer.`;
}

export function createTokenRefresh({ query, refreshToken, notifyUser, logger = console }) {
  async function notifyIfDegraded(account) {
    const [current] = await query(SELECT_ACCOUNT_STATUS, [account.id]);
    const newStatus = current?.status;
    if (!newStatus || newStatus === account.status) return;

    const type = DEGRADED_STATUS_TYPE[newStatus];
    if (!type) return;

    try {
      await notifyUser({
        userId: account.connected_by_user_id,
        brandId: account.brand_id,
        type,
        priority: 'HIGH',
        title: TOKEN_NOTIFICATION_TITLES[type],
        message: tokenNotificationMessage(type, account.name, account.provider),
        network: account.provider,
        resourceType: 'SOCIAL_ACCOUNT',
        resourceId: account.id,
        // Scopé par statut atteint, pas par exécution du balayage : une
        // dégradation supplémentaire (EXPIRING -> EXPIRED) notifie à nouveau,
        // un statut inchangé (déjà exclu ci-dessus) ne le ferait pas de
        // toute façon.
        eventId: `social-account:${account.id}:${newStatus}`,
      });
    } catch (error) {
      // Ne doit jamais faire régresser le rafraîchissement lui-même, déjà
      // effectué (ou tenté) indépendamment de la notification.
      logger.warn?.({ scope: 'token-refresh', action: 'notify', socialAccountId: account.id, error: error?.message });
    }
  }

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

      if (notifyUser) await notifyIfDegraded(account);
    }

    return { inspected: accounts.length, refreshed, failed };
  }

  return { run };
}
