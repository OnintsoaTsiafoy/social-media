import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

const SERVICE_JWT_AUDIENCE = 'social-service';
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
export function mintServiceJwt(scope) {
  return jwt.sign(
    { scope, type: 'service', jti: randomUUID() },
    requiredSecret(),
    {
      algorithm: 'HS256',
      subject: 'hootly-worker',
      audience: SERVICE_JWT_AUDIENCE,
      expiresIn: SERVICE_JWT_TTL_SECONDS,
    }
  );
}
