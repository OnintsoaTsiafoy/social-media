import assert from 'node:assert/strict';
import test from 'node:test';
import { createKnowledgeSchema, retrieveSchema, updateKnowledgeSchema } from '../src/knowledge/schemas.js';
import { vectorLiteral, publicDocument } from '../src/knowledge/service.js';
import { editDistance } from '../src/ai-feedback/service.js';

test('knowledge validates UUID ownership, size and optimistic revision', () => {
  assert.throws(() => createKnowledgeSchema.parse({ brandId: 1, title: 'FAQ', documentType: 'FAQ', content: 'texte' }));
  assert.throws(() => updateKnowledgeSchema.parse({ title: 'FAQ', documentType: 'FAQ', content: 'texte' }));
  assert.throws(() => createKnowledgeSchema.parse({ brandId: 'af41c792-fd86-4f91-a233-12df70a004d3', title: 'FAQ', documentType: 'FAQ', content: 'x'.repeat(250001) }));
  assert.throws(() => retrieveSchema.parse({ brandId: 'af41c792-fd86-4f91-a233-12df70a004d3', query: 'bonjour', limit: 100 }));
});

test('vectors reject incompatible, empty, nonnumeric or nonfinite embeddings', () => {
  for (const vector of [null, [], Array(384).fill(0), Array(384).fill(NaN), Array(384).fill(Infinity), Array(384).fill('1')]) {
    assert.throws(() => vectorLiteral(vector));
  }
  assert.ok(vectorLiteral([1, ...Array(383).fill(0)]).startsWith('[1,0,'));
});

test('document serialization never returns embeddings or internal author IDs', () => {
  const doc = publicDocument({ id: 'doc', content: 'privé', userId: 'secret', embedding: [1], chunks: [{ embedding: [1] }] });
  assert.equal(doc.content, undefined);
  assert.equal(doc.userId, undefined);
  assert.equal(doc.embedding, undefined);
  assert.equal(doc.chunks, undefined);
});

test('edit distance measures substitutions, insertion, deletion and unicode codepoints', () => {
  assert.equal(editDistance('Bonjour', 'Bonjour'), 0);
  assert.equal(editDistance('abc', 'axc'), 1);
  assert.equal(editDistance('', 'été'), 3);
  assert.equal(editDistance('Merci 😀', 'Merci'), 2);
});
