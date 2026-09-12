import assert from 'node:assert/strict';
import test from 'node:test';

import { hashState } from '../src/social-accounts/service.js';
import {
  connectSchema,
  listAccountsQuerySchema,
  oauthStatusQuerySchema,
  providerParamSchema,
  socialAccountIdSchema,
} from '../src/social-accounts/schemas.js';

test('provider param only accepts facebook or instagram', () => {
  assert.equal(providerParamSchema.parse('facebook'), 'facebook');
  assert.equal(providerParamSchema.parse('instagram'), 'instagram');
  assert.throws(() => providerParamSchema.parse('twitter'));
});

test('connect requires a brandId and a mobile redirect uri', () => {
  const brandId = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
  assert.deepEqual(connectSchema.parse({ brandId, mobileRedirectUri: 'hootly://oauth/callback' }), {
    brandId,
    mobileRedirectUri: 'hootly://oauth/callback',
  });
  assert.throws(() => connectSchema.parse({ brandId: 'pas-un-uuid', mobileRedirectUri: 'hootly://x' }));
  assert.throws(() => connectSchema.parse({ brandId }));
});

test('oauth status query requires a non-empty state', () => {
  assert.throws(() => oauthStatusQuerySchema.parse({}));
  assert.throws(() => oauthStatusQuerySchema.parse({ state: '' }));
  assert.equal(oauthStatusQuerySchema.parse({ state: 'abc' }).state, 'abc');
});

test('hashState matches graph-api core/crypto.py::hash_state for the same input', () => {
  // Cross-language test vector: sha256("test-raw-state-value") computed with
  // Python's hashlib in graph-api's own venv. A mismatch here would silently
  // break OAuth state consumption end-to-end rather than fail loudly.
  assert.equal(
    hashState('test-raw-state-value'),
    '12ac7a27326dbccaa385e96004591b0e506d65b629ce744fcc44599a35aaf7bf'
  );
});

test('list accounts requires a brandId', () => {
  const brandId = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
  assert.equal(listAccountsQuerySchema.parse({ brandId }).brandId, brandId);
  assert.throws(() => listAccountsQuerySchema.parse({}));
  assert.throws(() => listAccountsQuerySchema.parse({ brandId: 'pas-un-uuid' }));
});

test('social account id must be a uuid', () => {
  const id = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
  assert.equal(socialAccountIdSchema.parse(id), id);
  assert.throws(() => socialAccountIdSchema.parse('not-a-uuid'));
});

test('hashState never leaks the raw state in its output', () => {
  const hashed = hashState('super-secret-state');
  assert.equal(hashed.includes('super-secret-state'), false);
  assert.equal(hashed.length, 64);
});
