import assert from 'node:assert/strict';
import test from 'node:test';

import { socialAccountRouter } from '../src/social-accounts/routes.js';
import { hashState } from '../src/social-accounts/service.js';
import {
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

test('POST /:provider/connect refuse tout le monde : la liaison est réservée à la console d’administration', () => {
  const layer = socialAccountRouter.stack.find((entry) => entry.route?.path === '/:provider/connect');
  // La route existe encore : un 404 ressemblerait à une panne pour une ancienne version du mobile.
  assert.ok(layer, 'la route répond encore, par un refus explicite');
  assert.deepEqual(Object.keys(layer.route.methods), ['post']);
  assert.equal(layer.route.stack.length, 1, 'aucun middleware de marque ni de lecture du corps avant le refus');

  assert.throws(
    () => layer.route.stack[0].handle({}, {}, () => {}),
    (error) => error.status === 403 && error.code === 'forbidden' && /console d’administration/.test(error.message)
  );
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
