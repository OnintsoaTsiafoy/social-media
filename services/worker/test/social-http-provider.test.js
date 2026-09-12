import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderError } from '../../shared/social-provider.js';
import { createSocialHttpProvider } from '../src/social-http-provider.js';

process.env.SERVICE_JWT_SECRET = 'test-service-secret-at-least-32-bytes-long';
process.env.SOCIAL_SERVICE_URL = 'http://graph-api.test';

function fakeFetch(handler) {
  return async (url, options) => handler(url, options);
}

const COMMAND = {
  publicationId: 'pub-1',
  publicationTargetId: 'target-1',
  socialAccountId: 'account-1',
  provider: 'facebook',
  content: 'Bonjour',
  attemptNumber: 1,
  mediaUrls: [],
};

test('deliver posts to /internal/v1/publications/publish with a service JWT and an idempotency key', async () => {
  let capturedUrl;
  let capturedOptions;
  const provider = createSocialHttpProvider({
    fetchImpl: fakeFetch(async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        json: async () => ({
          publicationId: 'pub-1',
          results: [{ provider: 'facebook', status: 'SUCCESS', externalPublicationId: 'ext-1' }],
        }),
      };
    }),
  });

  const result = await provider.deliver(COMMAND);

  assert.equal(result.externalPublicationId, 'ext-1');
  assert.equal(capturedUrl, 'http://graph-api.test/internal/v1/publications/publish');
  assert.equal(capturedOptions.headers['Idempotency-Key'], 'pub-1:target-1:1');
  assert.match(capturedOptions.headers.Authorization, /^Bearer .+/);
  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.targets[0].socialAccountId, 'account-1');
});

test('a per-target business failure raises a ProviderError with the same code', async () => {
  const provider = createSocialHttpProvider({
    fetchImpl: fakeFetch(async () => ({
      ok: true,
      json: async () => ({
        publicationId: 'pub-1',
        results: [{ provider: 'facebook', status: 'FAILED', errorCode: 'TOKEN_EXPIRED' }],
      }),
    })),
  });

  await assert.rejects(provider.deliver(COMMAND), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, 'TOKEN_EXPIRED');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('a transient provider_unavailable failure is retryable', async () => {
  const provider = createSocialHttpProvider({
    fetchImpl: fakeFetch(async () => ({
      ok: true,
      json: async () => ({
        publicationId: 'pub-1',
        results: [{ provider: 'facebook', status: 'FAILED', errorCode: 'provider_unavailable' }],
      }),
    })),
  });

  await assert.rejects(provider.deliver(COMMAND), (error) => {
    assert.equal(error.retryable, true);
    return true;
  });
});

test('a network failure raises a retryable ProviderError', async () => {
  const provider = createSocialHttpProvider({
    fetchImpl: fakeFetch(async () => {
      throw new Error('ECONNREFUSED');
    }),
  });

  await assert.rejects(provider.deliver(COMMAND), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.retryable, true);
    return true;
  });
});

test('a route-level HTTP error (e.g. 401/503) raises a ProviderError', async () => {
  const provider = createSocialHttpProvider({
    fetchImpl: fakeFetch(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: 'provider_unavailable', message: 'Service social indisponible.' } }),
    })),
  });

  await assert.rejects(provider.deliver(COMMAND), (error) => {
    assert.equal(error.code, 'provider_unavailable');
    assert.equal(error.retryable, true);
    return true;
  });
});
