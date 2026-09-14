import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { once } from 'node:events';
import { app } from '../src/server.js';
import { prisma } from '../src/db/prisma.js';
import { createAccessToken } from '../src/auth/tokens.js';

// Real PostgreSQL/pgvector; AI and Meta remain mocked. Only test fixtures are
// created/deleted. Run with RAG_INTEGRATION=1 after applying migrations.
test('RAG, permissions, versioned human feedback and concurrent decisions', { skip: process.env.RAG_INTEGRATION !== '1' }, async () => {
  const savedFetch = globalThis.fetch;
  const savedAiUrl = process.env.AI_SERVICE_URL;
  process.env.AI_SERVICE_URL = 'http://rag-ai.test';
  const vector = (absent = false) => Array.from({ length: 384 }, (_, i) => Number(i === (absent ? 1 : 0)));
  const prompts = [];
  let indexFails = false;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('http://rag-ai.test')) return savedFetch(url, options);
    const body = JSON.parse(options.body);
    let result;
    if (String(url).endsWith('/prepare')) {
      if (indexFails) return Response.json({ error: { code: 'ai_error', message: 'Indexation indisponible' } }, { status: 503 });
      result = { model: 'intfloat/multilingual-e5-small', chunks: [{ content: body.content, embedding: vector(), metadata: {} }] };
    } else if (String(url).endsWith('/embed')) result = { model: 'intfloat/multilingual-e5-small', embeddings: [vector(body.texts[0] === 'absent')] };
    else if (String(url).endsWith('/safety-check')) result = { blocked: body.text.includes('INTERDIT'), warnings: [] };
    else if (String(url).endsWith('/generate')) {
      prompts.push(body);
      const blocked = body.strategy !== 'llm' && !body.documents.length;
      result = { analysis: { sentiment: 'neutral', intent: 'question', priority: 'medium' }, suggestion: {
        text: blocked ? 'Validation humaine nécessaire.' : 'Bonjour, nous sommes ouverts de 9h à 18h.',
        language: 'fr', tone: 'professional', generator: 'test-model', promptVersion: 'rag-test', warnings: [], blocked,
      } };
    } else throw new Error(`Unexpected AI route ${url}`);
    return Response.json(result);
  };
  const users = [], brands = [];
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function actor() {
    const user = await prisma.user.create({ data: { email: `rag-test-${randomUUID()}@example.invalid`, passwordHash: 'unused', firstName: 'Rag', lastName: 'Test', displayName: 'Rag Test' } });
    users.push(user.id);
    const session = await prisma.userSession.create({ data: { userId: user.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } });
    return { id: user.id, token: createAccessToken(user.id, session.id) };
  }
  async function request(actor_, path, method = 'GET', body, expected = 200) {
    const response = await savedFetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${actor_.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = response.status === 204 ? null : await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(json)}`);
    return json?.data;
  }
  try {
    const owner = await actor(), colleague = await actor(), stranger = await actor();
    async function brandFor(actor_) {
      const brand = await prisma.brand.create({ data: { ownerUserId: actor_.id, name: 'RAG integration test', members: { create: { userId: actor_.id, role: 'OWNER', isActive: true } } } });
      brands.push(brand.id);
      return brand;
    }
    const brand = await brandFor(owner), otherBrand = await brandFor(stranger);
    await prisma.brandMember.create({ data: { brandId: brand.id, userId: colleague.id, role: 'COMMUNITY_MANAGER' } });
    const account = await prisma.socialAccount.create({ data: { brandId: brand.id, connectedByUserId: owner.id, provider: 'FACEBOOK', externalAccountId: randomUUID(), name: 'Test', authMethod: 'FACEBOOK_PAGE' } });
    async function comment(text = 'Quels sont vos horaires ?') {
      return prisma.socialComment.create({ data: { socialAccountId: account.id, externalCommentId: randomUUID(), content: text } });
    }
    const input = { brandId: brand.id, title: 'Horaires', documentType: 'FAQ', content: 'Nous sommes ouverts de 9h à 18h.' };
    const doc = await request(owner, '/knowledge', 'POST', input, 201);
    assert.equal(doc.status, 'READY'); assert.equal(doc.chunkCount, 1);
    await request(stranger, `/knowledge/${doc.id}`, 'GET', undefined, 404);
    await request(colleague, `/knowledge/${doc.id}`, 'GET', undefined, 404);
    await request(stranger, '/ai/retrieve', 'POST', { brandId: brand.id, query: 'horaires' }, 404);
    await request(stranger, '/knowledge', 'POST', { ...input, brandId: otherBrand.id, title: 'Autre marque' }, 201);
    await request(colleague, '/knowledge', 'POST', { ...input, title: 'Document du collègue' }, 201);
    const internal = await request(owner, '/knowledge', 'POST', { ...input, title: 'Secret interne', internal: true }, 201);
    const found = await request(owner, '/ai/retrieve', 'POST', { brandId: brand.id, query: 'horaires' });
    assert.deepEqual(found.results.map((r) => r.documentId), [doc.id]);
    assert.ok(found.results[0].score > 0.99); assert.equal(found.results[0].embedding, undefined);
    const absent = await request(owner, '/ai/retrieve', 'POST', { brandId: brand.id, query: 'absent' });
    assert.equal(absent.results.length, 0);
    const c1 = await comment();
    const response = await request(owner, '/ai/responses', 'POST', { commentId: c1.id }, 201);
    assert.equal(response.sources[0].documentId, doc.id);
    assert.equal(response.sources[0].content, undefined);
    await request(owner, `/comments/${c1.id}/reply`, 'POST', undefined, 409);
    await request(stranger, `/ai/responses/${response.id}/accept`, 'POST', {}, 404);
    await Promise.all([1, 2].map(() => request(owner, `/ai/responses/${response.id}/accept`, 'POST', { rating: 5 })));
    assert.equal(await prisma.aiFeedback.count({ where: { responseId: response.id } }), 1);
    assert.equal(await prisma.sentResponse.count({ where: { commentId: c1.id } }), 0);
    await request(owner, `/ai/responses/${response.id}/reject`, 'POST', {}, 409);
    const c2 = await comment();
    const second = await request(owner, '/ai/responses', 'POST', { commentId: c2.id }, 201);
    assert.equal(prompts.at(-1).examples.length, 1);
    assert.equal(prompts.at(-1).examples[0].finalResponse, response.text);
    const edited = await request(owner, `/ai/responses/${second.id}/edit`, 'POST', { text: 'Bonjour, nos horaires sont de 9h à 18h. À bientôt !', reason: 'Ton incorrect', rating: 4 });
    assert.equal(edited.status, 'approved');
    assert.equal(edited.generatedText, second.text);
    const secondStored = await prisma.responseSuggestion.findUnique({ where: { id: second.id }, include: { feedback: true } });
    assert.equal(secondStored.text, second.text);
    assert.equal(secondStored.feedback.feedbackType, 'EDITED');
    assert.equal(secondStored.feedback.finalResponse, edited.text);
    const c3 = await comment();
    const third = await request(owner, '/ai/responses', 'POST', { commentId: c3.id }, 201);
    const regenerated = await request(owner, `/ai/responses/${third.id}/regenerate`, 'POST', {}, 201);
    assert.equal(regenerated.version, third.version + 1);
    await request(owner, `/ai/responses/${third.id}/accept`, 'POST', {}, 409);
    await request(owner, `/ai/responses/${regenerated.id}/reject`, 'POST', { reason: 'Réponse non pertinente' });
    const missing = await comment('absent');
    const blocked = await request(owner, '/ai/responses', 'POST', { commentId: missing.id }, 201);
    assert.equal(blocked.blocked, true);
    await request(owner, `/ai/responses/${blocked.id}/accept`, 'POST', {}, 409);
    const stats = await request(owner, `/ai/feedback/stats?brandId=${brand.id}`);
    assert.equal(stats.generated, 5); assert.equal(stats.accepted, 1); assert.equal(stats.edited, 1);
    assert.equal(stats.rejected, 1); assert.equal(stats.regenerated, 1); assert.equal(stats.acceptanceRate, 0.2);
    assert.equal(stats.sentiments.neutral, 5); assert.equal(stats.intents.question, 5);
    const otherStats = await request(stranger, `/ai/feedback/stats?brandId=${otherBrand.id}`);
    assert.equal(otherStats.generated, 0);
    const dataset = await request(owner, `/ai/feedback/dataset?brandId=${brand.id}`);
    assert.equal(dataset.items.length, 5);
    assert.ok(dataset.items.some((r) => r.edited && r.finalResponse === edited.text));
    // Legacy POST drafts must retain the AI generation they are correcting.
    const manualComment = await comment();
    const manualRoot = await request(owner, '/ai/responses', 'POST', { commentId: manualComment.id }, 201);
    const manualText = 'Bonjour, nous vous accueillons de 9h à 18h.';
    const manualDraft = await request(owner, '/ai/responses', 'POST', { commentId: manualComment.id, text: manualText }, 201);
    assert.equal(manualDraft.generatedText, manualRoot.text);
    const pendingStats = await request(owner, `/ai/feedback/stats?brandId=${brand.id}`);
    assert.equal(pendingStats.generated, 6);
    assert.equal(pendingStats.edited, 1);
    await request(owner, `/ai/responses/${manualDraft.id}/accept`, 'POST', {});
    const manualFeedback = await prisma.aiFeedback.findUnique({ where: { responseId: manualRoot.id } });
    assert.equal(manualFeedback.feedbackType, 'EDITED');
    assert.equal(manualFeedback.finalResponse, manualText);
    indexFails = true;
    const failed = await request(owner, `/knowledge/${doc.id}/reindex`, 'POST');
    assert.equal(failed.status, 'FAILED');
    const unavailable = await request(owner, '/ai/retrieve', 'POST', { brandId: brand.id, query: 'horaires' });
    assert.equal(unavailable.results.length, 0);
    indexFails = false;
    const retried = await request(owner, `/knowledge/${doc.id}/reindex`, 'POST');
    assert.equal(retried.status, 'READY');
    await request(owner, `/knowledge/${doc.id}`, 'PUT', { ...input, revision: doc.revision }, 409);
    await request(owner, `/knowledge/${doc.id}`, 'DELETE', undefined, 204);
    assert.equal(await prisma.knowledgeChunk.count({ where: { documentId: doc.id } }), 0);
    const historical = await request(owner, `/ai/responses/${response.id}`);
    assert.equal(historical.sources[0].title, 'Horaires');
    assert.equal((await request(owner, '/ai/retrieve', 'POST', { brandId: brand.id, query: 'horaires' })).results.length, 0);
    await request(owner, `/knowledge/${internal.id}`, 'DELETE', undefined, 204);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedAiUrl === undefined) delete process.env.AI_SERVICE_URL; else process.env.AI_SERVICE_URL = savedAiUrl;
    await prisma.brand.deleteMany({ where: { id: { in: brands } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
