import assert from 'node:assert/strict';
import test from 'node:test';

import { updatePreferencesSchema, updateProfileSchema } from '../src/profile/schemas.js';

test('profile validation accepts an IANA timezone and a normalized phone number', () => {
  const result = updateProfileSchema.parse({ timezone: 'Indian/Antananarivo', phone: '+261 34 12 345 67' });
  assert.equal(result.timezone, 'Indian/Antananarivo');
  assert.equal(result.phone, '+261 34 12 345 67');
});

test('profile validation rejects unsafe phone and timezone input', () => {
  assert.throws(() => updateProfileSchema.parse({ phone: 'not a phone' }));
  assert.throws(() => updateProfileSchema.parse({ timezone: 'Mars/Olympus' }));
});

test('preferences accepts only the declared user choices', () => {
  assert.deepEqual(updatePreferencesSchema.parse({ weeklyDigest: false, weekStartsOn: 'sunday' }), {
    weeklyDigest: false,
    weekStartsOn: 'sunday',
  });
  assert.throws(() => updatePreferencesSchema.parse({ weekStartsOn: 'friday' }));
});
