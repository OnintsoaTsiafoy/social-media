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
