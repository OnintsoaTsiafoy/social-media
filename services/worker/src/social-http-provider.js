import { ProviderError } from '../../shared/social-provider.js';
import { mintServiceJwt } from './lib/serviceJwt.js';

function baseUrl() {
  const value = process.env.SOCIAL_SERVICE_URL?.trim();
  if (!value) throw new Error('SOCIAL_SERVICE_URL est absent.');
  return value;
}

/**
 * Real graph-api-backed provider (Sprint 07), implementing the same
 * `deliver(command) -> { provider, externalPublicationId }` contract as
 * services/shared/social-provider.js's mock — swapped in via index.js,
 * while the mock stays the deterministic double this file's own tests and
 * delivery.test.js use.
 */
export function createSocialHttpProvider({ fetchImpl = fetch } = {}) {
  async function deliver(command) {
    const { publicationId, publicationTargetId, socialAccountId, provider, content, mediaUrls } = command;
    if (!socialAccountId) {
      // Sans compte, graph-api publierait sur la « page globale » du .env
      // (héritage Sprint 05, factice en local) : Meta la refuse, et l'erreur
      // remontée (`validation_failed`) ne dit pas pourquoi.
      throw new ProviderError('validation_failed', 'Aucun compte social n’est rattaché à cette publication.');
    }
    const token = mintServiceJwt(['social:write']);

    let response;
    try {
      response = await fetchImpl(`${baseUrl()}/internal/v1/publications/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          // One publish command per target, so the target's own delivery
          // attempt row (unique per (target, attemptNumber)) already gives a
          // stable, per-attempt idempotency key — no separate counter needed.
          'Idempotency-Key': `${publicationId}:${publicationTargetId}:${command.attemptNumber}`,
        },
        body: JSON.stringify({
          publicationId,
          targets: [
            {
              publicationTargetId,
              socialAccountId,
              provider,
              content,
              mediaUrls: mediaUrls ?? [],
            },
          ],
        }),
      });
    } catch {
      throw new ProviderError('provider_unavailable', 'Le service social est injoignable.', { retryable: true });
    }

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const code = payload?.error?.code ?? 'provider_unavailable';
      throw new ProviderError(code, payload?.error?.message ?? 'Le service social a renvoyé une erreur.', {
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    const result = payload?.results?.[0];
    if (!result || result.status !== 'SUCCESS') {
      const code = result?.errorCode ?? 'provider_unavailable';
      // A per-target business failure (invalid media, expired token, ...) is
      // not a transport error: retry only the codes shared with the mock's
      // own transient set, everything else needs a human fix.
      const retryable = ['provider_unavailable', 'provider_timeout', 'PROVIDER_RATE_LIMIT'].includes(code);
      throw new ProviderError(code, 'La publication a échoué.', { retryable });
    }

    return { provider, externalPublicationId: result.externalPublicationId };
  }

  // `requiresSocialAccount` : delivery.js retrouve le compte de la cible avant
  // d'appeler `deliver` (le mock, lui, livre sans compte).
  return { deliver, name: 'graph-api', requiresSocialAccount: true };
}
