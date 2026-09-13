import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

// Une audience par service interne : graph-api et ai-service partagent le
// secret de signature mais pas le périmètre (voir la note identique dans
// services/api/src/lib/serviceJwt.js).
export const SOCIAL_SERVICE_AUDIENCE = 'social-service';
export const AI_SERVICE_AUDIENCE = 'ai-service';
const SERVICE_JWT_TTL_SECONDS = 120;

function requiredSecret() {
  const value = process.env.SERVICE_JWT_SECRET?.trim();
  if (!value || value.startsWith('change-me')) {
    throw new Error('SERVICE_JWT_SECRET est absent ou est un placeholder de développement.');
  }
  return value;
}

// Deliberately duplicated from services/api/src/lib/serviceJwt.js rather than
// shared: services/shared/ imports no npm package (see its README), and
// jsonwebtoken is one. The worker calls graph-api's /internal/v1 directly
// (see docs/DECISIONS_ARCHITECTURE.md's topology diagram — Worker --> Social
// is its own edge, not proxied through Express); it already holds
// DATABASE_URL and S3 credentials directly, so minting its own short-lived
// service JWT doesn't raise its trust class.
export function mintServiceJwt(scope, audience = SOCIAL_SERVICE_AUDIENCE) {
  return jwt.sign(
    { scope, type: 'service', jti: randomUUID() },
    requiredSecret(),
    {
      algorithm: 'HS256',
      subject: 'hootly-worker',
      audience,
      expiresIn: SERVICE_JWT_TTL_SECONDS,
    }
  );
}
