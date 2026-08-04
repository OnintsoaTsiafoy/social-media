import jwt from 'jsonwebtoken';

import { HttpError } from '../lib/http.js';

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith('change-me')) {
    throw new HttpError(503, 'authentication_not_configured', 'Le service d’authentification n’est pas configuré.');
  }
  return value;
}

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function commonOptions() {
  return {
    issuer: process.env.JWT_ISSUER?.trim() || 'hootly-api',
    audience: process.env.JWT_AUDIENCE?.trim() || 'hootly-mobile',
  };
}

export function accessTokenTtlSeconds() {
  return positiveIntegerEnv('ACCESS_TOKEN_TTL_SECONDS', 900);
}

export function refreshTokenTtlSeconds() {
  return positiveIntegerEnv('REFRESH_TOKEN_TTL_SECONDS', 2_592_000);
}

export function createAccessToken(userId, sessionId) {
  return jwt.sign(
    { sid: sessionId, tokenType: 'access' },
    requiredEnv('JWT_ACCESS_SECRET'),
    {
      ...commonOptions(),
      algorithm: 'HS256',
      subject: userId,
      expiresIn: accessTokenTtlSeconds(),
    }
  );
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, requiredEnv('JWT_ACCESS_SECRET'), {
      ...commonOptions(),
      algorithms: ['HS256'],
    });
    if (typeof payload === 'string' || payload.tokenType !== 'access' || !payload.sub || !payload.sid) {
      throw new HttpError(401, 'authentication_required', 'Authentification requise.');
    }
    return { userId: payload.sub, sessionId: payload.sid };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new HttpError(401, 'token_expired', 'Votre session a expiré.');
    }
    throw new HttpError(401, 'authentication_required', 'Authentification requise.');
  }
}
