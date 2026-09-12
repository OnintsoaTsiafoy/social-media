import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpError } from '../src/lib/http.js';
import { callSocialService } from '../src/lib/socialServiceClient.js';

process.env.SERVICE_JWT_SECRET = 'test-service-jwt-secret-at-least-32-bytes-long';
process.env.SOCIAL_SERVICE_URL = 'http://graph-api.test';

function stubFetch(status, body) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// graph-api raises its own UPPER_SNAKE codes (OAuth/account lifecycle) that
// are not part of this codebase's documented error table — the mobile
// client's errorFromResponse only recognizes this codebase's vocabulary, so
// an untranslated code silently falls through to the wrong copy.
test('translates graph-api REAUTHENTICATION_REQUIRED to this codebase\'s token_expired', async () => {
  const restore = stubFetch(409, { error: { code: 'REAUTHENTICATION_REQUIRED', message: 'Reconnexion requise.' } });
  try {
    await assert.rejects(
      () => callSocialService('/internal/v1/social-accounts/acc-1/refresh-token', { scope: 'social:write' }),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 409);
        assert.equal(error.code, 'token_expired');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('translates graph-api OAUTH_CONFIGURATION_ERROR to provider_unavailable', async () => {
  const restore = stubFetch(503, { error: { code: 'OAUTH_CONFIGURATION_ERROR', message: 'Non configuré.' } });
  try {
    await assert.rejects(
      () => callSocialService('/internal/v1/oauth/instagram/authorization-url', { scope: 'social:write' }),
      (error) => {
        assert.equal(error.code, 'provider_unavailable');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('translates graph-api TOKEN_EXPIRED to this codebase\'s token_expired', async () => {
  // Distinct code from REAUTHENTICATION_REQUIRED, same meaning — raised by
  // internal_service.py's per-target resolution (publish/sync/reply), first
  // reachable through Express via comments/reply (Sprint 08 Day 5).
  const restore = stubFetch(409, { error: { code: 'TOKEN_EXPIRED', message: 'Reconnexion requise.' } });
  try {
    await assert.rejects(
      () => callSocialService('/internal/v1/comments/reply', { scope: 'social:write' }),
      (error) => {
        assert.equal(error.code, 'token_expired');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('leaves an already-known code untouched', async () => {
  const restore = stubFetch(404, { error: { code: 'not_found', message: 'Compte introuvable.' } });
  try {
    await assert.rejects(
      () => callSocialService('/internal/v1/social-accounts/acc-1/permissions', { method: 'GET', scope: 'social:read' }),
      (error) => {
        assert.equal(error.code, 'not_found');
        return true;
      }
    );
  } finally {
    restore();
  }
});
