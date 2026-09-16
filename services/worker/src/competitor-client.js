import { mintServiceJwt } from './lib/serviceJwt.js';

function baseUrl() {
  const value = process.env.SOCIAL_SERVICE_URL?.trim();
  if (!value) throw new Error('SOCIAL_SERVICE_URL est absent.');
  return value;
}

// Même arête directe worker → graph-api que social-account-client.js (voir
// docs/DECISIONS_ARCHITECTURE.md : le worker ne passe pas par Express).
async function call(path, body) {
  const token = mintServiceJwt(['social:read']);
  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.code ?? `competitor_call_failed_${response.status}`);
  }
  return response.json();
}

/**
 * Profil public d'un concurrent.
 *
 * Répond 200 même quand Meta refuse : le refus est porté par `status`
 * (ACTIVE / UNAVAILABLE / PERMISSION_REQUIRED / SYNC_ERROR). Seules les
 * pannes d'infrastructure lèvent — c'est ce qui permet au worker de persister
 * « ce concurrent n'est plus lisible » comme un fait, et non de le retenter
 * indéfiniment.
 */
export function defaultFetchCompetitorProfile(socialAccountId, platform, handle) {
  return call('/internal/v1/competitors/profile', { socialAccountId, platform, handle });
}

export function defaultFetchCompetitorPosts(socialAccountId, platform, handle, { limit = 25, maxPages = 4 } = {}) {
  return call('/internal/v1/competitors/posts', { socialAccountId, platform, handle, limit, maxPages });
}

/** Audience du compte de la marque lui-même, relevée dans la même passe pour
 * que les deux côtés de la comparaison partagent la même définition du taux
 * d'engagement. */
export function defaultFetchAccountAudience(socialAccountId) {
  return call('/internal/v1/accounts/audience', { socialAccountId });
}
