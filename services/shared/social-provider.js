/**
 * Connecteur social simulé du Sprint 04.
 *
 * Les vrais appels Meta passeront par `graph-api` (`/internal/v1`) au Sprint 05
 * et exigent des comptes liés par OAuth (Sprint 06). Tant que ces deux sprints
 * ne sont pas livrés, le worker exécute réellement le workflow de publication,
 * mais l'appel réseau est remplacé par ce connecteur déterministe.
 *
 * Déclencheurs, pour la démonstration et les tests :
 * - `[[FAIL_TEMP]]` dans le contenu : échec temporaire, éligible au retry ;
 * - `[[FAIL_PERM]]` : échec permanent, aucun retry ;
 * - `[[TIMEOUT]]`   : délai dépassé, éligible au retry ;
 * - `[[FAIL_INSTAGRAM]]` / `[[FAIL_FACEBOOK]]` : échec d'un seul réseau, ce qui
 *   produit le statut `PARTIALLY_PUBLISHED`.
 */

export class ProviderError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

function externalId(provider, publicationId, attemptNumber) {
  const prefix = provider.toLowerCase().slice(0, 2);
  return `${prefix}_${publicationId.replace(/-/g, '').slice(0, 12)}_${attemptNumber}`;
}

/**
 * @param {{ publicationId: string, provider: string, content: string, attemptNumber?: number, mediaCount?: number }} command
 * @returns {Promise<{ externalPublicationId: string, provider: string }>}
 */
export async function deliver(command) {
  const { publicationId, provider, content = '', attemptNumber = 1 } = command;
  const marker = content.toUpperCase();

  if (marker.includes('[[TIMEOUT]]')) {
    throw new ProviderError('provider_timeout', 'Le réseau social n’a pas répondu dans le délai imparti.', {
      retryable: true,
    });
  }
  if (marker.includes('[[FAIL_TEMP]]')) {
    throw new ProviderError('provider_unavailable', 'Le réseau social est momentanément indisponible.', {
      retryable: true,
    });
  }
  if (marker.includes('[[FAIL_PERM]]')) {
    throw new ProviderError('content_rejected', 'Le réseau social a refusé ce contenu.', { retryable: false });
  }
  if (marker.includes(`[[FAIL_${provider.toUpperCase()}]]`)) {
    throw new ProviderError('provider_unavailable', `Envoi impossible vers ${provider.toLowerCase()}.`, {
      retryable: true,
    });
  }

  return { provider, externalPublicationId: externalId(provider, publicationId, attemptNumber) };
}

export const mockSocialProvider = { deliver, name: 'mock' };

/**
 * Contenu réellement envoyé à un réseau : le texte adapté par réseau prime sur
 * le texte commun, et les hashtags sont concaténés une seule fois.
 */
export function composeContent(publication, target) {
  const text = target?.adaptedContent?.trim() || publication.content || '';
  const rawTags = target?.adaptedHashtags?.length ? target.adaptedHashtags : publication.hashtags;
  const tags = (Array.isArray(rawTags) ? rawTags : [])
    .filter((tag) => typeof tag === 'string' && tag.trim())
    .map((tag) => (tag.startsWith('#') ? tag.trim() : `#${tag.trim()}`));

  return tags.length ? `${text}\n\n${tags.join(' ')}` : text;
}
