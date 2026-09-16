import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { app } from '../src/server.js';
import { prisma } from '../src/db/prisma.js';
import { createAccessToken } from '../src/auth/tokens.js';
import { localInsightExplanation, localInsightPlan } from '../src/analytics/insightExplanation.js';

test('analytics insights: PostgreSQL, filters, LLM validation, history, feedback and access', {
  skip: process.env.ANALYTICS_INTEGRATION !== '1',
}, async () => {
  const users = [], brands = [];
  const nativeFetch = globalThis.fetch;
  const savedAiUrl = process.env.AI_SERVICE_URL;
  process.env.AI_SERVICE_URL = 'http://analytics-ai.invalid';
  let mode = 'error', aiCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith(process.env.AI_SERVICE_URL)) return nativeFetch(url, options);
    aiCalls++;
    assert.equal(options.headers['x-request-id'], 'analytics-integration');
    const input = JSON.parse(options.body);
    assert.deepEqual(Object.keys(input).sort(), ['facts', 'metrics', 'network', 'period', 'periodEnd', 'periodStart', 'warnings']);
    assert.ok(!options.body.includes('private-content'));
    if (mode === 'error') throw new Error('Unavailable');
    const result = { plan: localInsightPlan(input.facts), explanation: localInsightExplanation(input), model: 'mock-model', aiStatus: 'available' };
    if (mode === 'invented') result.explanation.summary = 'Engagement : 999 %.';
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/analytics`;
  async function actor() {
    const user = await prisma.user.create({ data: { email: `insights-${randomUUID()}@example.invalid`,
      passwordHash: 'unused', firstName: 'Analytics', lastName: 'Test', displayName: 'Analytics Test' } });
    users.push(user.id);
    const session = await prisma.userSession.create({ data: { userId: user.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } });
    return { id: user.id, token: createAccessToken(user.id, session.id) };
  }
  async function request(actor_, path, method = 'GET', body, expected = 200) {
    const result = await nativeFetch(`${base}${path}`, { method,
      headers: { Authorization: `Bearer ${actor_.token}`, 'Content-Type': 'application/json', 'x-request-id': 'analytics-integration' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await result.json();
    assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(json)}`);
    return json.data;
  }
  try {
    const owner = await actor(), viewer = await actor(), outsider = await actor();
    const brand = await prisma.brand.create({ data: { name: 'Analytics integration', ownerUserId: owner.id,
      members: { create: [{ userId: owner.id, role: 'OWNER' }, { userId: viewer.id, role: 'VIEWER' }] } } });
    brands.push(brand.id);
    const other = await prisma.brand.create({ data: { name: 'Other scope', ownerUserId: owner.id,
      members: { create: { userId: owner.id, role: 'OWNER' } } } });
    brands.push(other.id);
    for (const provider of ['FACEBOOK', 'INSTAGRAM']) {
      const account = await prisma.socialAccount.create({ data: { brandId: brand.id, provider, name: 'Fixture',
        externalAccountId: randomUUID(), connectedByUserId: owner.id, authMethod: 'FACEBOOK_PAGE' } });
      for (const age of [1, 2, 3, 8, 9, 10]) {
        await prisma.publication.create({ data: { brandId: brand.id, createdByUserId: owner.id, content: 'private-content',
          status: 'PUBLISHED', publishedAt: new Date(Date.now() - age * 86400000), targets: { create: {
            provider, socialAccountId: account.id, status: 'SENT', metrics: { create: {
              collectedAt: new Date(), reactions: age < 7 ? 30 : 10, comments: 5, shares: 5, reach: 100, impressions: 200,
            } },
          } } } });
      }
      const comment = await prisma.socialComment.create({ data: { socialAccountId: account.id,
        externalCommentId: randomUUID(), content: 'private-content' } });
      const analysis = await prisma.commentAnalysis.create({ data: { commentId: comment.id, sentiment: 'NEGATIVE',
        intent: 'COMPLAINT', priority: 'HIGH', confidence: 1, sentimentConfidence: 1, intentConfidence: 1,
        isUrgent: true, recommendedAction: 'Review', explanation: 'Fixture', modelVersion: 'test', datasetVersion: 'test' } });
      await prisma.socialComment.update({ where: { id: comment.id }, data: { latestAnalysisId: analysis.id } });
      const suggestion = await prisma.responseSuggestion.create({ data: { commentId: comment.id, version: 1,
        text: 'private-content', originalText: 'private-content', status: 'SENT', generatedByAi: true,
        generator: 'test', promptVersion: 'test', createdByUserId: owner.id } });
      await prisma.aiFeedback.create({ data: { responseId: suggestion.id, userId: owner.id, feedbackType: 'ACCEPTED' } });
      await prisma.sentResponse.create({ data: { commentId: comment.id, socialAccountId: account.id, content: 'private-content',
        sentByUserId: owner.id, status: 'SUCCEEDED', finishedAt: new Date() } });
    }
    const input = { brandId: brand.id, period: '7d', network: 'all' };
    const query = new URLSearchParams(input).toString();
    const snapshot = await request(viewer, `/insights?${query}`);
    assert.equal(snapshot.metrics['current.engagement'].value, 40);
    assert.equal(snapshot.metrics['variation.engagement'].value, 100);
    assert.equal(snapshot.metrics['current.urgentComments'].value, 2);
    assert.equal(snapshot.metrics['current.responsesSent'].value, 2);
    assert.equal(snapshot.metrics['current.acceptanceRate'].value, 100);
    assert.equal(snapshot.ai.status, 'not_requested');
    assert.equal(aiCalls, 0);
    for (const period of ['7d', '30d', '90d']) for (const network of ['all', 'facebook', 'instagram']) {
      const data = await request(viewer, `/insights?${new URLSearchParams({ ...input, period, network })}`);
      assert.equal(data.coverage.currentPublications, (period === '7d' ? 3 : 6) * (network === 'all' ? 2 : 1));
    }
    await request(viewer, '/insights', 'POST', input, 403);
    await request(outsider, `/insights?${query}`, 'GET', undefined, 404);
    await request(owner, '/insights', 'POST', { ...input, metrics: {} }, 400);
    const first = await request(owner, '/insights', 'POST', input, 201);
    assert.equal(first.ai.status, 'fallback');
    assert.equal(first.historical, false);
    mode = 'invented';
    const rejected = await request(owner, '/insights', 'POST', input, 201);
    assert.equal(rejected.ai.status, 'fallback');
    assert.ok(!rejected.summary.includes('999'));
    mode = 'valid';
    const valid = await request(owner, '/insights', 'POST', input, 201);
    assert.equal(valid.ai.status, 'available');
    const history = await request(viewer, `/insights/history?${query}&pageSize=1`);
    assert.equal(history.total, 3);
    assert.equal(history.items[0].id, valid.id);
    assert.equal(history.items[0].historical, true);
    const secondPage = await request(viewer, `/insights/history?${query}&pageSize=1&page=2`);
    assert.equal(secondPage.items[0].id, rejected.id);
    const detail = `/insights/${first.id}?brandId=${brand.id}`;
    assert.deepEqual((await request(viewer, detail)).metricsSnapshot, first.metricsSnapshot);
    await request(owner, `/insights/${first.id}?brandId=${other.id}`, 'GET', undefined, 404);
    await request(outsider, detail, 'GET', undefined, 404);
    const feedback = `/insights/${first.id}/feedback?brandId=${brand.id}`;
    await request(viewer, feedback, 'PUT', { useful: false, comment: 'Trop général' });
    await request(owner, feedback, 'PUT', { useful: true });
    let stats = await request(viewer, `/insights/feedback/stats?${query}`);
    assert.equal(stats.satisfactionRate, 50);
    assert.equal(stats.mostRejected[0].insightId, first.id);
    await request(viewer, feedback, 'PUT', { useful: true, comment: 'Précisé' });
    await request(viewer, feedback, 'PUT', { useful: true, comment: 'Précisé' });
    stats = await request(viewer, `/insights/feedback/stats?${query}`);
    assert.equal(stats.total, 2);
    assert.equal(stats.satisfactionRate, 100);
    assert.equal(stats.mostRejected.length, 0);
    assert.equal((await request(viewer, detail)).feedback.comment, 'Précisé');
    assert.equal((await request(owner, detail)).feedback.comment, '');
    await request(outsider, feedback, 'PUT', { useful: false }, 404);
    await request(owner, `/insights/${first.id}/feedback?brandId=${other.id}`, 'PUT', { useful: false }, 404);
    const empty = await request(owner, '/insights', 'POST', { ...input, brandId: other.id }, 201);
    assert.equal(empty.metricsSnapshot.facts.length, 0);
    assert.ok(!empty.summary.match(/\d/));
    assert.equal(await prisma.auditLog.count({ where: { resourceId: valid.id, action: 'analytics_insight.generated', requestId: 'analytics-integration' } }), 1);
  } finally {
    globalThis.fetch = nativeFetch;
    if (savedAiUrl === undefined) delete process.env.AI_SERVICE_URL; else process.env.AI_SERVICE_URL = savedAiUrl;
    await prisma.brand.deleteMany({ where: { id: { in: brands } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
