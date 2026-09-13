import { HttpError } from './http.js';
import { mintServiceJwt } from './serviceJwt.js';

function baseUrl() {
  const value = process.env.SOCIAL_SERVICE_URL?.trim();
  if (!value) {
    throw new HttpError(503, 'provider_unavailable', 'Le service social n’est pas configuré.');
  }
  return value;
}

// graph-api raises its own UPPER_SNAKE codes internally (OAuth/account
// lifecycle) — never part of this codebase's documented error table
// (docs/CONTRATS_API.md). Translated here, at the one place every
// social-accounts call funnels through, so the mobile client (whose
// errorFromResponse/ApiErrorCode only know this codebase's vocabulary) gets
// a code it actually recognizes instead of falling through to a generic,
// misleading one (e.g. REAUTHENTICATION_REQUIRED landing on the mobile's
// plain "conflict" message instead of its purpose-built "reconnect your
// social account" copy for token_expired).
const CODE_TRANSLATIONS = {
  REAUTHENTICATION_REQUIRED: 'token_expired',
  // Distinct from REAUTHENTICATION_REQUIRED (Sprint 06's account-level
  // revalidation failure) but the same user-facing meaning: no usable Meta
  // token right now. Raised by internal_service.py's per-target resolution
  // (publish/sync/reply) — previously only ever seen by the worker (which
  // doesn't translate codes, it just displays lastErrorMessage), now also
  // reachable through Express via comments/reply (Sprint 08 Day 5).
  TOKEN_EXPIRED: 'token_expired',
  OAUTH_CONFIGURATION_ERROR: 'provider_unavailable',
  PROVIDER_NOT_SUPPORTED: 'validation_failed',
};

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

  // Résolu avant le try : `baseUrl()` lève quand SOCIAL_SERVICE_URL est
  // absent, et le `catch` ci-dessous remplaçait ce message de configuration
  // par « le service social est injoignable » — trompeur pour qui diagnostique
  // un déploiement. Les deux cas partagent le même code, donc rien ne le
  // signalait ; trouvé en écrivant aiServiceClient.js, où les deux codes
  // diffèrent.
  const target = `${baseUrl()}${path}`;

  let response;
  try {
    response = await fetch(target, {
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
    const rawCode = payload?.error?.code ?? 'provider_unavailable';
    const code = CODE_TRANSLATIONS[rawCode] ?? rawCode;
    const message = payload?.error?.message ?? 'Le service social a renvoyé une erreur.';
    throw new HttpError(response.status, code, message, payload?.error?.details);
  }

  return payload;
}
