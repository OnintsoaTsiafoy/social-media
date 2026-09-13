import { HttpError } from './http.js';
import { AI_SERVICE_AUDIENCE, mintServiceJwt } from './serviceJwt.js';

function baseUrl() {
  const value = process.env.AI_SERVICE_URL?.trim();
  if (!value) {
    throw new HttpError(503, 'provider_unavailable', 'Le service d’analyse n’est pas configuré.');
  }
  return value;
}

// Même forme que socialServiceClient.js — volontairement séparé plutôt que
// factorisé derrière un paramètre d'URL : les deux clients divergent déjà par
// l'audience du jeton et par leur table de traduction d'erreurs, et les
// fusionner ferait qu'un ajout côté Meta toucherait le chemin de l'IA.
//
// ai-service parle déjà le vocabulaire d'erreur documenté (il partage la
// table de codes de graph-api/core/exceptions.py), à une exception près :
// `ai_error`, qu'il est le seul à produire et que le mobile ne connaît pas.
const CODE_TRANSLATIONS = {
  ai_error: 'ai_unavailable',
  // Modèles non entraînés / mode non supporté : de la configuration absente,
  // pas une panne — mais du point de vue du mobile c'est la même chose,
  // l'analyse n'est pas disponible maintenant.
  provider_unavailable: 'ai_unavailable',
};

export async function callAiService(path, { method = 'POST', scope = 'ai:analyze', body } = {}) {
  const token = mintServiceJwt(scope ? [scope] : [], AI_SERVICE_AUDIENCE);
  // Résolu AVANT le try : une URL absente est un défaut de configuration
  // (`provider_unavailable`), pas une panne réseau, et le `catch` ci-dessous
  // masquerait la différence en réécrivant le code de l'erreur.
  const target = `${baseUrl()}${path}`;

  let response;
  try {
    response = await fetch(target, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new HttpError(503, 'ai_unavailable', 'Le service d’analyse est injoignable.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const rawCode = payload?.error?.code ?? 'ai_error';
    const code = CODE_TRANSLATIONS[rawCode] ?? rawCode;
    const message = payload?.error?.message ?? 'Le service d’analyse a renvoyé une erreur.';
    throw new HttpError(response.status, code, message, payload?.error?.details);
  }

  return payload;
}
