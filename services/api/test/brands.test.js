import assert from 'node:assert/strict';
import test from 'node:test';

import { hasBrandRole } from '../src/brands/middleware.js';
import { createBrandSchema, updateAiSettingsSchema, updateBrandSchema } from '../src/brands/schemas.js';
import { toPublicBrand } from '../src/brands/service.js';

test('brand roles prevent a viewer from administering a brand', () => {
  assert.equal(hasBrandRole('OWNER', 'ADMIN'), true);
  assert.equal(hasBrandRole('ADMIN', 'ADMIN'), true);
  assert.equal(hasBrandRole('COMMUNITY_MANAGER', 'ADMIN'), false);
  assert.equal(hasBrandRole('VIEWER', 'COMMUNITY_MANAGER'), false);
});

test('brand creation rejects invalid identity data', () => {
  assert.throws(() => createBrandSchema.parse({ name: 'A', primaryLanguage: 'de' }));
});

test('partial brand updates do not overwrite omitted fields with defaults', () => {
  assert.deepEqual(updateBrandSchema.parse({ name: 'Nouveau nom' }), { name: 'Nouveau nom' });
});

test('custom AI tone requires an explicit description', () => {
  assert.throws(() => updateAiSettingsSchema.parse({ expectedVersion: 1, tone: 'custom' }));
  assert.equal(
    updateAiSettingsSchema.parse({ expectedVersion: 1, tone: 'custom', customTone: 'Direct et sans jargon.' }).tone,
    'custom'
  );
});

test('AI settings require the version displayed to the user', () => {
  assert.throws(() => updateAiSettingsSchema.parse({ greeting: 'Bonjour,' }));
});

test('brand API shape preserves the mobile banned-terms field', () => {
  const brand = toPublicBrand({
    id: 'brand-id',
    name: 'Studio Vega',
    description: null,
    industry: null,
    primaryLanguage: 'fr',
    status: 'ACTIVE',
    createdAt: new Date('2026-08-04T00:00:00.000Z'),
    updatedAt: new Date('2026-08-04T00:00:00.000Z'),
    aiSettings: [
      {
        version: 1,
        tone: 'PROFESSIONAL',
        customTone: null,
        formality: 'ADAPTIVE',
        language: 'fr',
        emojisAllowed: true,
        targetLength: '2 phrases',
        greeting: null,
        closing: null,
        forbiddenTerms: ['gratuit'],
        recommendedTerms: ['bonjour'],
        instructions: null,
        complaintInstructions: null,
        urgencyInstructions: null,
        supportInstructions: null,
      },
    ],
  });

  assert.deepEqual(brand.bannedTerms, ['gratuit']);
  assert.deepEqual(brand.recommendedTerms, ['bonjour']);
  assert.equal(brand.version, 1);
});
