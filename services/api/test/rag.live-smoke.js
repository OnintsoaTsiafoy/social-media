import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/db/prisma.js';
import { createAccessToken } from '../src/auth/tokens.js';

if (process.argv.includes('--cleanup')) {
  const fixtures = await prisma.user.findMany({ where: {
    email: { startsWith: 'rag-smoke-', endsWith: '@example.invalid' }, passwordHash: 'unused',
    displayName: 'RAG smoke test',
  }, select: { id: true } });
  for (const fixture of fixtures) {
    await prisma.brand.deleteMany({ where: { ownerUserId: fixture.id, name: 'RAG smoke fixture' } });
    await prisma.auditLog.deleteMany({ where: { userId: fixture.id } });
    await prisma.user.delete({ where: { id: fixture.id } });
  }
  await prisma.$disconnect();
  console.log(`Removed ${fixtures.length} interrupted smoke-test fixture(s).`);
  process.exit(0);
}

// Explicit smoke test against the running API and real local embedding model.
// Never calls a send/reply endpoint. Removes only the fixtures it creates.
const user = await prisma.user.create({ data: {
  email: `rag-smoke-${randomUUID()}@example.invalid`, passwordHash: 'unused',
  firstName: 'Smoke', lastName: 'Test', displayName: 'RAG smoke test',
} });
let brand;
try {
  const session = await prisma.userSession.create({ data: { userId: user.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } });
  const token = createAccessToken(user.id, session.id);
  brand = await prisma.brand.create({ data: { ownerUserId: user.id, name: 'RAG smoke fixture',
    members: { create: { userId: user.id, role: 'OWNER', isActive: true } } } });
  const headers = { Authorization: `Bearer ${token}` };
  async function request(path, method = 'GET', body, status = 200) {
    const isForm = body instanceof FormData;
    const response = await fetch(`http://api:3000/api/v1${path}`, { method,
      headers: isForm ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    const payload = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, JSON.stringify(payload));
    return payload?.data;
  }
  const form = new FormData();
  form.append('brandId', brand.id);
  form.append('title', 'FAQ horaires');
  form.append('documentType', 'FAQ');
  form.append('file', new Blob(['Quels sont les horaires de la boutique ? Notre boutique est ouverte du lundi au vendredi de 9h à 18h.'], { type: 'text/plain' }), 'horaires.txt');
  const doc = await request('/knowledge/upload', 'POST', form, 201);
  assert.equal(doc.status, 'READY', doc.error);
  const retrieved = await request('/ai/retrieve', 'POST', { brandId: brand.id, query: 'Quels sont vos horaires ?' });
  assert.equal(retrieved.results[0]?.documentId, doc.id);
  const absent = await request('/ai/retrieve', 'POST', { brandId: brand.id, query: 'Quel est le prix du manteau Orion en taille M ?' });
  assert.equal(absent.results.length, 0);
  const account = await prisma.socialAccount.create({ data: { brandId: brand.id, connectedByUserId: user.id,
    provider: 'FACEBOOK', authMethod: 'FACEBOOK_PAGE', externalAccountId: randomUUID(), name: 'Smoke fixture' } });
  const comments = [];
  for (let i = 0; i < 2; i += 1) comments.push(await prisma.socialComment.create({ data: { socialAccountId: account.id, externalCommentId: randomUUID(), content: 'Quels sont vos horaires ?' } }));
  const generated = await request('/ai/responses', 'POST', { commentId: comments[0].id }, 201);
  assert.equal(generated.sources[0]?.documentId, doc.id);
  assert.equal(generated.blocked, true); // Local extraction must be adapted.
  await request(`/ai/responses/${generated.id}/accept`, 'POST', {}, 409);
  const approved = await request(`/ai/responses/${generated.id}/edit`, 'POST', {
    text: 'Bonjour, notre boutique est ouverte du lundi au vendredi de 9h à 18h.', rating: 5,
  });
  assert.equal(approved.status, 'approved');
  const following = await request('/ai/responses', 'POST', { commentId: comments[1].id }, 201);
  assert.equal(following.similarExamples.length, 1);
  const stats = await request(`/ai/feedback/stats?brandId=${brand.id}`);
  assert.equal(stats.generated, 2); assert.equal(stats.edited, 1);
  assert.equal(await prisma.sentResponse.count({ where: { socialAccountId: account.id } }), 0);
  console.log(JSON.stringify({ result: 'PASS', upload: 'TXT', chunks: doc.chunkCount,
    retrievalScore: retrieved.confidenceScore, absentQuestion: 'no_sources',
    generator: generated.generator, validatedExamples: following.similarExamples.length, sentReplies: 0 }));
} finally {
  if (brand) await prisma.brand.delete({ where: { id: brand.id } });
  await prisma.auditLog.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}
