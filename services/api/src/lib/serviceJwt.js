import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { HttpError } from './http.js';

// Une audience par service interne appelé. graph-api et ai-service partagent
// le même secret de signature mais n'ont pas le même périmètre : un jeton
// émis pour publier chez Meta ne doit pas ouvrir l'analyse IA, et
// réciproquement. Chaque service vérifie SON audience (voir
// graph-api/core/security.py et services/ai-service/core/security.py).
export const SOCIAL_SERVICE_AUDIENCE = 'social-service';
export const AI_SERVICE_AUDIENCE = 'ai-service';
const SERVICE_JWT_TTL_SECONDS = 120;

function requiredSecret() {
  const value = process.env.SERVICE_JWT_SECRET?.trim();
  if (!value || value.startsWith('change-me')) {
    throw new HttpError(503, 'provider_unavailable', 'Le JWT de service n’est pas configuré.');
  }
  return value;
}

// Minted fresh for every outbound call to graph-api — short-lived on
// purpose, never cached or reused (see docs/CONTRATS_API.md / sprint_listing
// APIS/11_SECURITE_JWT_OAUTH.md). Never forward a mobile/user JWT instead.
export function mintServiceJwt(scope, audience = SOCIAL_SERVICE_AUDIENCE) {
  return jwt.sign(
    { scope, type: 'service', jti: randomUUID() },
    requiredSecret(),
    {
      algorithm: 'HS256',
      subject: 'hootly-api',
      audience,
      expiresIn: SERVICE_JWT_TTL_SECONDS,
    }
  );
}
