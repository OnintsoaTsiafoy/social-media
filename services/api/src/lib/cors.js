// CORS pour la console d'administration web, quand elle est servie depuis une
// autre origine que l'API (en développement, le proxy de Vite l'évite).
//
// Liste blanche explicite : `CORS_ALLOWED_ORIGINS` (origines séparées par des
// virgules, ex. `https://admin.hootly.app`). Sans elle, aucun en-tête CORS n'est
// émis — l'app mobile n'en a pas besoin et l'API reste fermée aux navigateurs
// tiers par défaut. Jamais de `*` : les requêtes portent un jeton `Authorization`.

const ALLOWED_HEADERS = 'Authorization, Content-Type, X-Request-Id, X-Device-Name';
const EXPOSED_HEADERS = 'X-Request-Id';
const PREFLIGHT_MAX_AGE_SECONDS = '600';

export function allowedOrigins(env = process.env) {
  return (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function corsMiddleware(env = process.env) {
  const origins = new Set(allowedOrigins(env));

  return (request, response, next) => {
    const origin = request.get('origin');
    // Le résultat dépend de l'en-tête Origin : les caches doivent le savoir.
    response.vary('Origin');
    if (!origin || !origins.has(origin)) {
      next();
      return;
    }

    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);

    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      response.setHeader('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);
      response.status(204).end();
      return;
    }
    next();
  };
}
