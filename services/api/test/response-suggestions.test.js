import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approveSuggestionSchema,
  createSuggestionSchema,
  generateHashtagsSchema,
  listSuggestionsQuerySchema,
  rejectSuggestionSchema,
  suggestionIdSchema,
  updateSuggestionSchema,
} from '../src/response-suggestions/schemas.js';
import { toPublicSuggestion } from '../src/response-suggestions/service.js';

const UUID = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';

test('suggestion id must be a uuid', () => {
  assert.throws(() => suggestionIdSchema.parse('nope'));
  assert.equal(suggestionIdSchema.parse(UUID), UUID);
});

// Sans `text`, la proposition est générée ; avec `text`, c'est le community
// manager qui a rédigé et on enregistre sa version telle quelle.
test('creating a suggestion works with or without a text', () => {
  assert.equal(createSuggestionSchema.parse({ commentId: UUID }).text, undefined);
  assert.equal(createSuggestionSchema.parse({ commentId: UUID, text: 'Merci !' }).text, 'Merci !');
  assert.throws(() => createSuggestionSchema.parse({}));
});

test('creating a suggestion rejects an unknown tone or language', () => {
  assert.equal(createSuggestionSchema.parse({ commentId: UUID, tone: 'empathetic' }).tone, 'empathetic');
  assert.equal(createSuggestionSchema.parse({ commentId: UUID, language: 'ar' }).language, 'ar');
  assert.throws(() => createSuggestionSchema.parse({ commentId: UUID, tone: 'sarcastique' }));
  assert.throws(() => createSuggestionSchema.parse({ commentId: UUID, language: 'kl' }));
});

// La borne doit rester alignée sur MAX_RESPONSE_LENGTH du mobile et sur
// `max_response_characters` du service d'analyse : une proposition acceptée
// ici mais refusée là-bas serait payée puis jetée.
test('a suggestion text is bounded to 500 characters', () => {
  assert.equal(updateSuggestionSchema.parse({ text: 'x'.repeat(500) }).text.length, 500);
  assert.throws(() => updateSuggestionSchema.parse({ text: 'x'.repeat(501) }));
  assert.throws(() => updateSuggestionSchema.parse({ text: '   ' }));
  assert.throws(() => updateSuggestionSchema.parse({}));
});

test('approving accepts an optional last-minute edit', () => {
  assert.deepEqual(approveSuggestionSchema.parse({}), {});
  assert.equal(approveSuggestionSchema.parse({ text: 'Version finale.' }).text, 'Version finale.');
  assert.throws(() => approveSuggestionSchema.parse({ text: 'x'.repeat(501) }));
});

test('rejecting accepts an optional reason', () => {
  assert.deepEqual(rejectSuggestionSchema.parse({}), {});
  assert.equal(rejectSuggestionSchema.parse({ reason: 'Trop sec' }).reason, 'Trop sec');
});

test('listing suggestions requires a commentId', () => {
  assert.throws(() => listSuggestionsQuerySchema.parse({}));
  assert.equal(listSuggestionsQuerySchema.parse({ commentId: UUID }).commentId, UUID);
});

test('hashtag generation requires a brand and a non-empty text', () => {
  assert.throws(() => generateHashtagsSchema.parse({ text: 'Bonjour' }));
  assert.throws(() => generateHashtagsSchema.parse({ brandId: UUID, text: '' }));
  const parsed = generateHashtagsSchema.parse({ brandId: UUID, text: 'Nouvelle collection', preserve: ['#ete'] });
  assert.deepEqual(parsed.preserve, ['#ete']);
});

test('an absent suggestion serialises to null, never to an empty draft', () => {
  assert.equal(toPublicSuggestion(null), null);
  assert.equal(toPublicSuggestion(undefined), null);
});

test('a stored suggestion is lowercased on the wire and keeps its original text', () => {
  const suggestion = toPublicSuggestion({
    id: UUID,
    text: 'Version corrigée par le CM.',
    originalText: 'Proposition initiale de l’IA.',
    language: 'fr',
    tone: 'EMPATHETIC',
    status: 'EDITED',
    createdAt: new Date('2026-09-13T10:00:00Z'),
    generatedByAi: false,
    version: 2,
    warnings: [{ code: 'markdown_formatting', severity: 'warning', message: '…' }],
    blocked: false,
    generator: 'local-template-1.0.0',
    promptVersion: 'local-template-1.0.0',
  });

  assert.equal(suggestion.tone, 'empathetic');
  assert.equal(suggestion.status, 'edited');
  assert.equal(suggestion.version, 2);
  // Le texte d'origine survit à la réécriture : c'est l'exigence « conserver
  // texte original et final ».
  assert.equal(suggestion.originalText, 'Proposition initiale de l’IA.');
  assert.equal(suggestion.generatedByAi, false);
  assert.equal(suggestion.warnings.length, 1);
  assert.equal(suggestion.blocked, false);
});

test('warnings default to an empty list rather than null', () => {
  const suggestion = toPublicSuggestion({
    id: UUID,
    text: 'Bonjour',
    originalText: 'Bonjour',
    language: 'fr',
    tone: 'PROFESSIONAL',
    status: 'PROPOSED',
    createdAt: new Date('2026-09-13T10:00:00Z'),
    generatedByAi: true,
    version: 1,
    warnings: null,
    blocked: false,
    generator: 'claude',
    promptVersion: 'comment-reply-1.0.0',
  });

  assert.deepEqual(suggestion.warnings, []);
});
