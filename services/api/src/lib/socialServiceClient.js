import { HttpError } from './http.js';
import { mintServiceJwt } from './serviceJwt.js';

function baseUrl() {
  const value = process.env.SOCIAL_SERVICE_URL?.trim();
  if (!value) {
    throw new HttpError(503, 'provider_unavailable', 'Le service social n’est pas configuré.');
  }
  return value;
}

// Thin wrapper around graph-api's /internal/v1: mints a fresh service JWT per
// call (never cached/reused) and translates its {error:{code,message}}
// envelope into an HttpError so callers only ever see this codebase's shape.
export async function callSocialService(path, { method = 'POST', scope, body, idempotencyKey } = {}) {
  const token = mintServiceJwt(scope ? [scope] : []);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new HttpError(503, 'provider_unavailable', 'Le service social est injoignable.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = payload?.error?.code ?? 'provider_unavailable';
    const message = payload?.error?.message ?? 'Le service social a renvoyé une erreur.';
    throw new HttpError(response.status, code, message, payload?.error?.details);
  }

  return payload;
}
