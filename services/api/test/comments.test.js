import assert from 'node:assert/strict';
import test from 'node:test';

import { authorInitials, notificationTypesForAnalysis, toPublicAnalysis } from '../src/comments/service.js';
import {
  commentIdSchema,
  commentsCountQuerySchema,
  escalateCommentSchema,
  listCommentsQuerySchema,
  setCommentStatusSchema,
  syncCommentsSchema,
} from '../src/comments/schemas.js';

test('comment id must be a uuid', () => {
  assert.throws(() => commentIdSchema.parse('not-a-uuid'));
  assert.equal(commentIdSchema.parse('8d10e3e8-85b7-4fd3-8e6c-67d3188eecab'), '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab');
});

test('list comments requires a brandId and defaults pagination', () => {
  const brandId = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
  const parsed = listCommentsQuerySchema.parse({ brandId });
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 20);
  assert.throws(() => listCommentsQuerySchema.parse({}));
});

test('list comments accepts known filters and rejects an unknown status', () => {
  const brandId = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
  assert.equal(listCommentsQuerySchema.parse({ brandId, status: 'ignored' }).status, 'ignored');
  assert.equal(listCommentsQuerySchema.parse({ brandId, network: 'instagram' }).network, 'instagram');
  assert.throws(() => listCommentsQuerySchema.parse({ brandId, status: 'analyzing' }));
  assert.throws(() => listCommentsQuerySchema.parse({ brandId, network: 'twitter' }));
});

test('comments count query requires a brandId', () => {
  assert.throws(() => commentsCountQuerySchema.parse({}));
  const brandId = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
  assert.equal(commentsCountQuerySchema.parse({ brandId }).brandId, brandId);
});

test('set status only accepts a forward-moving status, never "new"', () => {
  assert.equal(setCommentStatusSchema.parse({ status: 'processed' }).status, 'processed');
  assert.equal(setCommentStatusSchema.parse({ status: 'ignored' }).status, 'ignored');
  assert.equal(setCommentStatusSchema.parse({ status: 'escalated' }).status, 'escalated');
  assert.throws(() => setCommentStatusSchema.parse({ status: 'new' }));
  assert.throws(() => setCommentStatusSchema.parse({}));
});

test('escalate accepts an optional note', () => {
  assert.deepEqual(escalateCommentSchema.parse({}), {});
  assert.equal(escalateCommentSchema.parse({ note: 'Client mécontent' }).note, 'Client mécontent');
});

test('sync requires a brandId', () => {
  assert.throws(() => syncCommentsSchema.parse({}));
  const brandId = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
  assert.equal(syncCommentsSchema.parse({ brandId }).brandId, brandId);
});

test('authorInitials handles single word, multi-word, and missing names', () => {
  assert.equal(authorInitials('Alice Martin'), 'AM');
  assert.equal(authorInitials('Cher'), 'CH');
  assert.equal(authorInitials(null), '?');
  assert.equal(authorInitials(''), '?');
  assert.equal(authorInitials('  Bob   Dupont  '), 'BD');
});

test('list comments accepts the analysis filters added in Sprint 09', () => {
  const brandId = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
  assert.equal(listCommentsQuerySchema.parse({ brandId, sentiment: 'negative' }).sentiment, 'negative');
  assert.equal(listCommentsQuerySchema.parse({ brandId, intent: 'info_request' }).intent, 'info_request');
  assert.equal(listCommentsQuerySchema.parse({ brandId, priority: 'high' }).priority, 'high');
  assert.equal(listCommentsQuerySchema.parse({ brandId, sentiment: 'all' }).sentiment, 'all');
  assert.throws(() => listCommentsQuerySchema.parse({ brandId, sentiment: 'mitige' }));
  assert.throws(() => listCommentsQuerySchema.parse({ brandId, intent: 'insulte' }));
  assert.throws(() => listCommentsQuerySchema.parse({ brandId, priority: 'critique' }));
});

test('list comments defaults to the most recent first and accepts priority sorting', () => {
  const brandId = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';
  assert.equal(listCommentsQuerySchema.parse({ brandId }).sort, 'recent');
  assert.equal(listCommentsQuerySchema.parse({ brandId, sort: 'priority' }).sort, 'priority');
  assert.throws(() => listCommentsQuerySchema.parse({ brandId, sort: 'confidence' }));
});

// Un commentaire jamais analysé doit rendre `null`, jamais une analyse neutre
// par défaut : l'écran distingue « en attente d'analyse » de « analysé comme
// neutre », et une valeur inventée effacerait cette distinction.
test('an unanalysed comment exposes no analysis at all', () => {
  assert.equal(toPublicAnalysis(null), null);
  assert.equal(toPublicAnalysis(undefined), null);
});

test('a stored analysis is lowercased on the wire, matching the mobile vocabulary', () => {
  const analysed = toPublicAnalysis({
    sentiment: 'NEGATIVE',
    intent: 'CLAIM',
    priority: 'HIGH',
    confidence: 0.92,
    lowConfidence: false,
    isUrgent: true,
    isSensitive: false,
    recommendedAction: 'Traiter en priorité.',
    explanation: 'Message négatif.',
    analysedAt: new Date('2026-09-12T10:00:00Z'),
    modelVersion: 'fr-linear-1.0.0+v1',
  });

  assert.equal(analysed.sentiment, 'negative');
  assert.equal(analysed.intent, 'claim');
  assert.equal(analysed.priority, 'high');
  assert.equal(analysed.urgent, true);
  assert.equal(analysed.sensitive, false);
  assert.equal(analysed.analysedAt, '2026-09-12T10:00:00.000Z');
  assert.equal(analysed.modelVersion, 'fr-linear-1.0.0+v1');
});

// Sprint 11 Jour 3 — un commentaire neutre et non urgent ne doit déclencher
// aucune notification : sans ce test, une régression pousserait une alerte
// pour chaque commentaire reçu.
test('a neutral, non-urgent, low-priority analysis triggers no notification', () => {
  assert.deepEqual(
    notificationTypesForAnalysis({ priority: 'low', sentiment: 'neutral', urgent: false }),
    []
  );
});

test('a high-priority analysis triggers priority_comment', () => {
  assert.deepEqual(
    notificationTypesForAnalysis({ priority: 'high', sentiment: 'neutral', urgent: false }),
    ['PRIORITY_COMMENT']
  );
});

// Un même commentaire peut être à la fois urgent ET négatif : ce sont deux
// alertes distinctes, chacune avec son propre réglage côté utilisateur.
test('a comment can trigger multiple notification types at once', () => {
  assert.deepEqual(
    notificationTypesForAnalysis({ priority: 'high', sentiment: 'negative', urgent: true }),
    ['PRIORITY_COMMENT', 'NEGATIVE_COMMENT', 'URGENT_COMMENT']
  );
});

test('urgency alone (medium priority, neutral sentiment) still triggers urgent_comment', () => {
  assert.deepEqual(
    notificationTypesForAnalysis({ priority: 'medium', sentiment: 'neutral', urgent: true }),
    ['URGENT_COMMENT']
  );
});
