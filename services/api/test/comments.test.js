import assert from 'node:assert/strict';
import test from 'node:test';

import { authorInitials } from '../src/comments/service.js';
import {
  commentIdSchema,
  commentsCountQuerySchema,
  escalateCommentSchema,
  listCommentsQuerySchema,
  replyCommentSchema,
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

test('reply text must be non-empty and bounded', () => {
  assert.equal(replyCommentSchema.parse({ text: 'Merci !' }).text, 'Merci !');
  assert.throws(() => replyCommentSchema.parse({ text: '' }));
  assert.throws(() => replyCommentSchema.parse({}));
  assert.throws(() => replyCommentSchema.parse({ text: 'x'.repeat(8001) }));
});

test('authorInitials handles single word, multi-word, and missing names', () => {
  assert.equal(authorInitials('Alice Martin'), 'AM');
  assert.equal(authorInitials('Cher'), 'CH');
  assert.equal(authorInitials(null), '?');
  assert.equal(authorInitials(''), '?');
  assert.equal(authorInitials('  Bob   Dupont  '), 'BD');
});
