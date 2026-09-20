import { mintServiceJwt } from './lib/serviceJwt.js';

function baseUrl() {
  const value = process.env.SOCIAL_SERVICE_URL?.trim();
  if (!value) throw new Error('SOCIAL_SERVICE_URL est absent.');
  return value;
}

// Direct call to graph-api's /internal/v1 (see docs/DECISIONS_ARCHITECTURE.md's
// topology diagram: Worker --> Social is its own edge, not proxied through Express).
export async function defaultRefreshToken(socialAccountId) {
  const token = mintServiceJwt(['social:write']);
  const response = await fetch(
    `${baseUrl()}/internal/v1/social-accounts/${socialAccountId}/refresh-token`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.code ?? `refresh_failed_${response.status}`);
  }
  return response.json();
}

// Sprint 08 Day 3 — graph-api walks every page of every listed post
// internally and persists as it goes (see internal_service.py::sync_comments);
// this call's only job is to ask it to do that for one account.
export async function defaultSyncComments(socialAccountId, provider, publicationExternalIds) {
  const token = mintServiceJwt(['social:read']);
  const response = await fetch(`${baseUrl()}/internal/v1/comments/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      socialAccountId,
      provider,
      publicationExternalIds,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.code ?? `comment_sync_failed_${response.status}`);
  }
  return response.json();
}

// Import des publications d'une page. graph-api lit `posts_sync_pages_per_call`
// pages du fil chez Meta, écrit publications/cibles en base et répond avec un
// curseur de reprise tant que le fil n'est pas épuisé (`done: false`) : c'est à
// l'appelant (posts-sync.js) de boucler. Une passe est courte — quelques
// aller-retour vers Meta — d'où un délai d'attente borné : sans lui, un graph-api
// qui ne répond plus figerait le worker indéfiniment. Si le délai coupe un appel
// que graph-api termine quand même, la relance est sans effet (upsert).
const POSTS_SYNC_TIMEOUT_MS = 120_000;

export async function defaultSyncPosts(socialAccountId, provider, cursor) {
  const token = mintServiceJwt(['social:read']);
  const response = await fetch(`${baseUrl()}/internal/v1/posts/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ socialAccountId, provider, ...(cursor ? { cursor } : {}) }),
    signal: AbortSignal.timeout(POSTS_SYNC_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.code ?? `posts_sync_failed_${response.status}`);
  }
  return response.json();
}

// Sprint 12 — graph-api resolves each publication_target_id and persists a
// social_metrics snapshot as it collects each post's insights (see
// internal_service.py::sync_metrics); this call's only job is to ask it to
// do that for one account.
export async function defaultSyncMetrics(socialAccountId, provider, publicationExternalIds) {
  const token = mintServiceJwt(['social:read']);
  const response = await fetch(`${baseUrl()}/internal/v1/metrics/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      socialAccountId,
      provider,
      publicationExternalIds,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.code ?? `metrics_sync_failed_${response.status}`);
  }
  return response.json();
}
