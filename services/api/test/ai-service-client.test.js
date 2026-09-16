import assert from 'node:assert/strict';
import test from 'node:test';

import jwt from 'jsonwebtoken';

import { callAiService } from '../src/lib/aiServiceClient.js';
import { HttpError } from '../src/lib/http.js';

process.env.SERVICE_JWT_SECRET = 'test-service-jwt-secret-at-least-32-bytes-long';
process.env.AI_SERVICE_URL = 'http://ai-service.test';

function stubFetch(status, body, capture) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capture?.({ url, options });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('mints a token for the ai-service audience, never graph-api’s', async () => {
  // Une audience partagée ferait qu'un jeton émis pour publier chez Meta
  // ouvrirait aussi l'analyse : c'est exactement ce que ce test verrouille.
  let captured;
  const restore = stubFetch(200, { analysis: {} }, (call) => {
    captured = call;
  });
  try {
    await callAiService('/internal/v1/comments/analyze', { body: { text: 'Bonjour' } });
  } finally {
    restore();
  }

  const token = captured.options.headers.Authorization.replace('Bearer ', '');
  const payload = jwt.verify(token, process.env.SERVICE_JWT_SECRET, { audience: 'ai-service' });
  assert.equal(payload.type, 'service');
  assert.deepEqual(payload.scope, ['ai:analyze']);
});

test('a token minted for the AI service is rejected by graph-api’s audience', async () => {
  let captured;
  const restore = stubFetch(200, { analysis: {} }, (call) => {
    captured = call;
  });
  try {
    await callAiService('/internal/v1/comments/analyze', { body: { text: 'Bonjour' } });
  } finally {
    restore();
  }

  const token = captured.options.headers.Authorization.replace('Bearer ', '');
  assert.throws(() => jwt.verify(token, process.env.SERVICE_JWT_SECRET, { audience: 'social-service' }));
});

test('returns the parsed payload on success', async () => {
  const restore = stubFetch(200, { analysis: { sentiment: 'negative' } });
  try {
    const result = await callAiService('/internal/v1/comments/analyze', { body: { text: 'Nul' } });
    assert.equal(result.analysis.sentiment, 'negative');
  } finally {
    restore();
  }
});

test('analytics propagates requestId and its bounded timeout', async (context) => {
  let duration, captured;
  const signal = new AbortController().signal;
  context.mock.method(AbortSignal, 'timeout', (milliseconds) => { duration = milliseconds; return signal; });
  const restore = stubFetch(200, {}, (call) => { captured = call; });
  try {
    await callAiService('/internal/v1/analytics/explain', { scope: 'ai:generate', requestId: 'analytics-request', timeoutMs: 25000, body: {} });
    assert.equal(duration, 25000);
    assert.equal(captured.options.signal, signal);
    assert.equal(captured.options.headers['x-request-id'], 'analytics-request');
  } finally { restore(); }
});

test('translates the AI service’s own ai_error into the mobile’s ai_unavailable', async () => {
  // `ai_error` n'existe pas dans le vocabulaire du mobile : non traduit, il
  // retomberait sur un message générique au lieu de « saisissez le texte
  // manuellement ».
  const restore = stubFetch(500, { error: { code: 'ai_error', message: 'Erreur interne.' } });
  try {
    await assert.rejects(
      () => callAiService('/internal/v1/comments/analyze', { body: { text: 'Bonjour' } }),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.code, 'ai_unavailable');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('untrained models are reported as ai_unavailable, not as a server error', async () => {
  const restore = stubFetch(503, {
    error: { code: 'provider_unavailable', message: 'Modèles non entraînés.' },
  });
  try {
    await assert.rejects(
      () => callAiService('/internal/v1/comments/analyze', { body: { text: 'Bonjour' } }),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, 'ai_unavailable');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('a documented code is passed through untouched', async () => {
  const restore = stubFetch(400, { error: { code: 'validation_failed', message: 'Texte vide.' } });
  try {
    await assert.rejects(
      () => callAiService('/internal/v1/comments/analyze', { body: { text: ' ' } }),
      (error) => {
        assert.equal(error.code, 'validation_failed');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('an unreachable service is a 503, never an unhandled exception', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  try {
    await assert.rejects(
      () => callAiService('/internal/v1/comments/analyze', { body: { text: 'Bonjour' } }),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.code, 'ai_unavailable');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a missing AI_SERVICE_URL is reported before any call is attempted', async () => {
  const original = process.env.AI_SERVICE_URL;
  delete process.env.AI_SERVICE_URL;
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    await assert.rejects(
      () => callAiService('/internal/v1/comments/analyze', { body: { text: 'Bonjour' } }),
      (error) => {
        assert.equal(error.code, 'provider_unavailable');
        return true;
      }
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AI_SERVICE_URL = original;
  }
});
