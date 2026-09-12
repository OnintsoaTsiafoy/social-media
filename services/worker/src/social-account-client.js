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
