import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnalyticsSummary, insightRanges } from '../src/analytics/insightFacts.js';
import { localInsightExplanation, localInsightPlan, validateInsightExplanation } from '../src/analytics/insightExplanation.js';
import { insightFeedbackSchema, insightHistorySchema, insightQuerySchema } from '../src/analytics/schemas.js';

const NOW = new Date('2026-09-15T12:00:00Z');
const DAY = 86400000;
export function cohort(reactions = 10, overrides = {}) {
  const publications = [1, 2, 3].map((id) => ({ id: `publication-${id}`, publishedAt: new Date(NOW.getTime() - id * DAY),
    targets: [{ id: `target-${id}`, provider: id === 1 ? 'INSTAGRAM' : 'FACEBOOK' }] }));
  return { publications, metricsByTarget: new Map(publications.map((post) => [post.targets[0].id,
    { reactions, comments: 5, shares: 5, reach: 100, impressions: 200, collectedAt: NOW }])),
  comments: { total: 10, positive: 4, neutral: 2, negative: 4, urgent: 1, priority: 2,
    responsesGenerated: 10, responsesSent: 3, responsesAccepted: 4, responsesReviewed: 5 }, ...overrides };
}
export const summaryFixture = (current = cohort(30), previous = cohort(10), period = '7d', network = 'all') =>
  buildAnalyticsSummary({ period, network, range: insightRanges(period, NOW), current, previous });

test('insights accept 7/30/90 days and Facebook/Instagram/all, adjacent equal ranges', () => {
  for (const period of ['7d', '30d', '90d']) for (const network of ['facebook', 'instagram', 'all']) {
    const summary = summaryFixture(undefined, undefined, period, network);
    assert.equal(Date.parse(summary.periodEnd) - Date.parse(summary.periodStart), parseInt(period, 10) * DAY);
    assert.equal(summary.previousPeriodEnd, summary.periodStart);
    assert.equal(Date.parse(summary.previousPeriodEnd) - Date.parse(summary.previousPeriodStart), parseInt(period, 10) * DAY);
    assert.equal(insightQuerySchema.parse({ brandId: '123e4567-e89b-42d3-a456-426614174000', period, network }).network, network);
  }
});

test('positive and negative engagement variations use backend percentages', () => {
  const increase = summaryFixture();
  assert.equal(increase.metrics['current.engagement'].value, 40);
  assert.equal(increase.metrics['previous.engagement'].value, 20);
  assert.equal(increase.facts.find((fact) => fact.type === 'engagement_increase').value, 100);
  const decrease = summaryFixture(cohort(10), cohort(30));
  assert.equal(decrease.facts.find((fact) => fact.type === 'engagement_decrease').value, -50);
  assert.equal(increase.metrics['current.acceptanceRate'].value, 80);
});

test('empty, zero-baseline, insufficient and partial metrics do not yield invented comparisons', () => {
  const empty = cohort(0, { publications: [], metricsByTarget: new Map(),
    comments: { total: 0, positive: 0, neutral: 0, negative: 0, urgent: 0, priority: 0,
      responsesGenerated: 0, responsesSent: 0, responsesAccepted: 0, responsesReviewed: 0 } });
  const summary = summaryFixture(empty, empty);
  assert.equal(summary.metrics['current.engagement'].value, null);
  assert.equal(summary.metrics['current.urgentComments'].value, null);
  assert.equal(summary.facts.length, 0);
  assert.match(localInsightExplanation(summary).summary, /ne permettent pas/);
  const partial = cohort();
  partial.metricsByTarget.get('target-1').reach = null;
  const mixed = summaryFixture(partial);
  assert.equal(mixed.metrics['current.engagement'].availability, 'partial');
  assert.ok(!mixed.facts.some((fact) => fact.metric.includes('engagement')));
  const small = cohort(); small.publications.pop();
  assert.equal(summaryFixture(small).variations.find((entry) => entry.metric === 'engagement').reason, 'insufficient_data');
  const zero = cohort(); for (const value of zero.metricsByTarget.values()) { value.reactions = 0; value.comments = 0; value.shares = 0; }
  assert.equal(summaryFixture(undefined, zero).variations.find((entry) => entry.metric === 'engagement').reason, 'zero_baseline');
});

test('spikes, concentrated engagement, sentiment shift and urgent increases are factual', () => {
  const current = cohort();
  current.metricsByTarget.get('target-1').reactions = 500;
  current.comments.negative = 8; current.comments.positive = 0; current.comments.urgent = 5;
  const result = summaryFixture(current);
  for (const type of ['interaction_peak', 'engagement_concentration', 'sentiment_shift', 'urgent_increase']) {
    assert.ok(result.anomalies.some((fact) => fact.type === type), type);
  }
  assert.equal(result.bestNetwork.network, 'instagram');
  assert.equal(result.metrics.sentimentShift.value, 40);
  assert.equal(result.metrics.urgentIncrease.value, 4);
  assert.equal(result.topPublications[0].publicationId, 'publication-1');
});

test('unanalysed comments and incomplete interactions suspend related claims', () => {
  const current = cohort(); current.comments.total = 20;
  current.metricsByTarget.get('target-1').shares = null;
  const result = summaryFixture(current);
  assert.equal(result.metrics['current.negativeShare'].availability, 'partial');
  assert.equal(result.bestNetwork, null);
  assert.ok(result.facts.every((fact) => result.metrics[fact.metric].availability === 'available'));
});

test('API rejects invented numbers, unknown metrics, wrong polarity and free model prose', () => {
  const snapshot = summaryFixture();
  const valid = { plan: localInsightPlan(snapshot.facts), explanation: localInsightExplanation(snapshot), model: 'fixture', aiStatus: 'available' };
  assert.deepEqual(validateInsightExplanation(snapshot, valid), valid);
  const invented = structuredClone(valid); invented.explanation.summary = 'Engagement : 999 %.';
  assert.throws(() => validateInsightExplanation(snapshot, invented));
  const swapped = structuredClone(valid); swapped.explanation.referencedMetrics = ['current.revenue'];
  assert.throws(() => validateInsightExplanation(snapshot, swapped));
  const unknown = structuredClone(valid); unknown.plan.summary = ['current_revenue'];
  assert.throws(() => validateInsightExplanation(snapshot, unknown));
  const polarity = structuredClone(valid); polarity.plan.attentionPoints = ['engagement_increase'];
  assert.throws(() => validateInsightExplanation(snapshot, polarity));
  const extra = structuredClone(valid); extra.plan.freeText = 'Chiffres inventés';
  assert.throws(() => validateInsightExplanation(snapshot, extra));
  assert.ok(valid.explanation.recommendations.length <= 3);
});

test('feedback and history reject excess, coercion and arbitrary fields', () => {
  assert.deepEqual(insightFeedbackSchema.parse({ useful: false, comment: '  À préciser  ' }), { useful: false, comment: 'À préciser' });
  assert.throws(() => insightFeedbackSchema.parse({ useful: 'false' }));
  assert.throws(() => insightFeedbackSchema.parse({ useful: true, comment: 'x'.repeat(1001) }));
  assert.throws(() => insightHistorySchema.parse({ brandId: '123e4567-e89b-42d3-a456-426614174000', pageSize: 21 }));
  assert.throws(() => insightQuerySchema.parse({ brandId: '123e4567-e89b-42d3-a456-426614174000', facts: [] }));
});
