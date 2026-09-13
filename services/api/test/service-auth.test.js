import assert from 'node:assert/strict';
import test from 'node:test';

import jwt from 'jsonwebtoken';

import { API_SERVICE_AUDIENCE, requireServiceAuth } from '../src/lib/serviceAuth.js';

const SECRET = 'test-only-service-jwt-secret-at-least-32-bytes-long';

function withSecret(fn) {
  const original = process.env.SERVICE_JWT_SECRET;
  process.env.SERVICE_JWT_SECRET = SECRET;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.SERVICE_JWT_SECRET;
    else process.env.SERVICE_JWT_SECRET = original;
  }
}

function fakeRequest(authorizationHeader) {
  return { get: (name) => (name.toLowerCase() === 'authorization' ? authorizationHeader : undefined) };
}

function run(middleware, authorizationHeader) {
  return new Promise((resolve) => {
    const request = fakeRequest(authorizationHeader);
    middleware(request, {}, (error) => resolve({ error, request }));
  });
}

test('a request with no bearer header is rejected as authentication_required', async () => {
  const { error } = await withSecret(() => run(requireServiceAuth('notifications:write'), undefined));
  assert.equal(error.status, 401);
  assert.equal(error.code, 'authentication_required');
});

test('a mobile/user-shaped token (type !== "service") is never accepted, even signed with the right secret', async () => {
  const token = jwt.sign({ scope: ['notifications:write'], type: 'access' }, SECRET, {
    algorithm: 'HS256',
    audience: API_SERVICE_AUDIENCE,
    expiresIn: 60,
  });
  const { error } = await withSecret(() => run(requireServiceAuth('notifications:write'), `Bearer ${token}`));
  assert.equal(error.status, 401);
});

test('a token minted for a different audience (e.g. graph-api) is rejected', async () => {
  const token = jwt.sign({ scope: ['notifications:write'], type: 'service' }, SECRET, {
    algorithm: 'HS256',
    audience: 'social-service',
    expiresIn: 60,
  });
  const { error } = await withSecret(() => run(requireServiceAuth('notifications:write'), `Bearer ${token}`));
  assert.equal(error.status, 401);
});

test('a valid service token missing the required scope is forbidden, not unauthenticated', async () => {
  const token = jwt.sign({ scope: ['social:read'], type: 'service' }, SECRET, {
    algorithm: 'HS256',
    audience: API_SERVICE_AUDIENCE,
    expiresIn: 60,
  });
  const { error } = await withSecret(() => run(requireServiceAuth('notifications:write'), `Bearer ${token}`));
  assert.equal(error.status, 403);
  assert.equal(error.code, 'forbidden');
});

test('a valid service token with the right audience and scope is accepted', async () => {
  const token = jwt.sign({ scope: ['notifications:write'], type: 'service', sub: 'hootly-worker' }, SECRET, {
    algorithm: 'HS256',
    audience: API_SERVICE_AUDIENCE,
    expiresIn: 60,
  });
  const { error, request } = await withSecret(() => run(requireServiceAuth('notifications:write'), `Bearer ${token}`));
  assert.equal(error, undefined);
  assert.equal(request.service.subject, 'hootly-worker');
});

test('an expired service token is rejected as token_expired', async () => {
  const token = jwt.sign({ scope: ['notifications:write'], type: 'service' }, SECRET, {
    algorithm: 'HS256',
    audience: API_SERVICE_AUDIENCE,
    expiresIn: -10,
  });
  const { error } = await withSecret(() => run(requireServiceAuth('notifications:write'), `Bearer ${token}`));
  assert.equal(error.status, 401);
  assert.equal(error.code, 'token_expired');
});
