import { AI_SERVICE_AUDIENCE, mintServiceJwt } from './lib/serviceJwt.js';

function baseUrl() {
  const value = process.env.AI_SERVICE_URL?.trim();
  if (!value) throw new Error('AI_SERVICE_URL est absent.');
  return value;
}

// Appel direct à /internal/v1 du service d'analyse, comme le worker appelle
// déjà graph-api sans passer par Express (voir la topologie de
// docs/DECISIONS_ARCHITECTURE.md). Le service est sans état : il reçoit un
// texte, renvoie un verdict, n'écrit rien — c'est le worker qui persiste.
export async function defaultAnalyseComment(commentId, text) {
  const token = mintServiceJwt(['ai:analyze'], AI_SERVICE_AUDIENCE);
  const response = await fetch(`${baseUrl()}/internal/v1/comments/analyze`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commentId, text }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.code ?? `comment_analysis_failed_${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.analysis) throw new Error('comment_analysis_empty_response');
  return payload.analysis;
}
