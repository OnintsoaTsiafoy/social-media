import assert from 'node:assert/strict';
import test from 'node:test';

import { registerSchema } from '../src/auth/schemas.js';
import { createAccessToken, verifyAccessToken } from '../src/auth/tokens.js';

process.env.JWT_ACCESS_SECRET = 'test-only-signing-secret-that-is-long-enough';
process.env.JWT_ISSUER = 'hootly-api';
process.env.JWT_AUDIENCE = 'hootly-mobile';

test('register schema normalizes the email and applies defaults', () => {
  const result = registerSchema.parse({
    email: '  LEA@STUDIO-VEGA.FR ',
    password: 'ChangeMe123!',
    firstName: 'Léa',
    lastName: 'Martin',
  });

  assert.equal(result.email, 'lea@studio-vega.fr');
  assert.equal(result.language, 'fr');
  assert.equal(result.timezone, 'Europe/Paris');
});

test('register schema rejects a weak password', () => {
  assert.throws(
    () => registerSchema.parse({
      email: 'lea@studio-vega.fr',
      password: 'password',
      firstName: 'Léa',
      lastName: 'Martin',
    })
  );
});

test('access token is constrained to its audience and session', () => {
  const token = createAccessToken('8d10e3e8-85b7-4fd3-8e6c-67d3188eecab', 'ee025d27-d721-41fd-a2a5-60f71caadb4a');
  const payload = verifyAccessToken(token);

  assert.deepEqual(payload, {
    userId: '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab',
    sessionId: 'ee025d27-d721-41fd-a2a5-60f71caadb4a',
  });
});
