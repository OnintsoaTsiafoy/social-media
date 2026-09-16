import { prisma } from '../db/prisma.js';
import { callAiService } from '../lib/aiServiceClient.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';
import { buildAnalyticsSummary, insightRanges, round } from './insightFacts.js';
import { FALLBACK_WARNING, localInsightExplanation, validateInsightExplanation } from './insightExplanation.js';

async function loadCohort(db, { brandId, network, from, to, asOf }) {
  const socialAccount = { brandId, ...(network === 'all' ? {} : { provider: network.toUpperCase() }) };
  const dateFilter = { gte: from, lt: to };
  const commentFilter = { socialAccount, createdAt: dateFilter, isDeletedOnPlatform: false };
  const generationFilter = { generatedByAi: true, createdAt: dateFilter, comment: { socialAccount } };
  const [publications, groups, total, responsesGenerated, responsesSent, responsesAccepted, responsesReviewed] = await Promise.all([
    db.publication.findMany({ where: { brandId, deletedAt: null, status: { in: ['PUBLISHED', 'PARTIALLY_PUBLISHED'] },
      publishedAt: dateFilter }, select: { id: true, publishedAt: true,
      targets: { where: { status: 'SENT', ...(network === 'all' ? {} : { provider: network.toUpperCase() }) },
        select: { id: true, provider: true } } } }),
    db.commentAnalysis.groupBy({ by: ['sentiment', 'priority', 'isUrgent'],
      where: { latestForComment: { is: commentFilter } }, _count: { _all: true } }),
    db.socialComment.count({ where: commentFilter }),
    db.responseSuggestion.count({ where: generationFilter }),
    // SentResponse has no suggestion FK. SENT is set only after a confirmed delivery;
    // generationId includes human edits of an AI proposal, excludes wholly manual replies.
    db.sentResponse.count({ where: { socialAccount, status: 'SUCCEEDED', finishedAt: dateFilter,
      comment: { suggestions: { some: { status: 'SENT', OR: [{ generatedByAi: true }, { generationId: { not: null } }] } } } } }),
    db.responseSuggestion.count({ where: { ...generationFilter, feedback: { is: { feedbackType: { in: ['ACCEPTED', 'EDITED'] } } } } }),
    db.responseSuggestion.count({ where: { ...generationFilter, feedback: { isNot: null } } }),
  ]);
  const scoped = publications.filter((post) => post.targets.length);
  const ids = scoped.flatMap((post) => post.targets.map((target) => target.id));
  const rows = ids.length ? await db.socialMetric.findMany({
    where: { publicationTargetId: { in: ids }, collectedAt: { lte: asOf } },
    orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }], distinct: ['publicationTargetId'],
    select: { publicationTargetId: true, reactions: true, comments: true, shares: true,
      reach: true, impressions: true, collectedAt: true },
  }) : [];
  const comments = { total, positive: 0, neutral: 0, negative: 0, urgent: 0, priority: 0,
    responsesGenerated, responsesSent, responsesAccepted, responsesReviewed };
  for (const row of groups) {
    comments[row.sentiment.toLowerCase()] += row._count._all;
    if (row.priority === 'HIGH') comments.priority += row._count._all;
    if (row.isUrgent) comments.urgent += row._count._all;
  }
  return { publications: scoped, metricsByTarget: new Map(rows.map((row) => [row.publicationTargetId, row])), comments };
}

export async function analyticsInsights({ brandId, period, network }, db = prisma) {
  const range = insightRanges(period);
  // A single consistent snapshot also keeps the acceptance numerator/denominator aligned.
  const summary = await db.$transaction(async (tx) => {
    const [current, previous] = await Promise.all([
      loadCohort(tx, { brandId, network, from: range.from, to: range.to, asOf: range.to }),
      loadCohort(tx, { brandId, network, from: range.previousFrom, to: range.from, asOf: range.to }),
    ]);
    return buildAnalyticsSummary({ period, network, range, current, previous });
  }, { isolationLevel: 'RepeatableRead', timeout: 15000 });
  return { ...summary, ai: { status: 'not_requested' } };
}

export function publicInsight(record, historical = true) {
  return { id: record.id, brandId: record.brandId, network: record.network, period: record.period,
    periodStart: record.periodStart, periodEnd: record.periodEnd, createdAt: record.createdAt,
    metricsSnapshot: record.metricsSnapshot, ...record.explanation, model: record.model,
    ai: { status: record.aiStatus }, historical,
    feedback: record.feedback?.[0] ? { useful: record.feedback[0].useful, comment: record.feedback[0].comment } : null };
}

export async function generateAnalyticsInsight(input, request, { db = prisma, explain = callAiService } = {}) {
  const snapshot = await analyticsInsights(input, db);
  let explanation = localInsightExplanation(snapshot), model = 'analytics-local-v1', aiStatus = 'fallback';
  if (snapshot.facts.length) {
    try {
      const result = validateInsightExplanation(snapshot, await explain('/internal/v1/analytics/explain', {
        scope: 'ai:generate', timeoutMs: 25000, requestId: request.requestId,
        body: { period: snapshot.period, network: snapshot.network, periodStart: snapshot.periodStart,
          periodEnd: snapshot.periodEnd, metrics: snapshot.metrics, facts: snapshot.facts, warnings: snapshot.warnings },
      }));
      ({ explanation, model, aiStatus } = result);
    } catch {
      console.warn({ event: 'analytics_insight_fallback', requestId: request.requestId });
    }
  }
  if (aiStatus === 'fallback') explanation = { ...explanation, warnings: [...explanation.warnings, FALLBACK_WARNING] };
  const created = await db.$transaction(async (tx) => {
    const record = await tx.analyticsInsight.create({ data: { brandId: input.brandId, network: input.network,
      period: input.period, periodStart: new Date(snapshot.periodStart), periodEnd: new Date(snapshot.periodEnd),
      metricsSnapshot: snapshot, summary: explanation.summary, recommendations: explanation.recommendations,
      explanation, model, aiStatus, requestId: request.requestId } });
    await writeAuditLog(tx, { userId: request.auth.user.id, action: 'analytics_insight.generated',
      resourceType: 'analytics_insight', resourceId: record.id, requestId: request.requestId,
      metadata: { brandId: input.brandId, period: input.period, network: input.network, model, aiStatus } });
    return record;
  });
  console.info({ event: 'analytics_insight_generated', requestId: request.requestId, insightId: created.id, model, aiStatus });
  return publicInsight(created, false);
}

const historyFilter = ({ brandId, period, network }) => ({ brandId, period, network });
export async function insightHistory(input, userId, db = prisma) {
  const where = historyFilter(input);
  const [rows, total] = await db.$transaction([
    db.analyticsInsight.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.pageSize, take: input.pageSize,
      include: { feedback: { where: { userId }, select: { useful: true, comment: true } } } }),
    db.analyticsInsight.count({ where }),
  ]);
  return { items: rows.map((row) => publicInsight(row)), total, page: input.page, pageSize: input.pageSize };
}

export async function insightDetail(brandId, id, userId, db = prisma) {
  const record = await db.analyticsInsight.findFirst({ where: { id, brandId },
    include: { feedback: { where: { userId }, select: { useful: true, comment: true } } } });
  if (!record) throw new HttpError(404, 'not_found', 'Analyse introuvable.');
  return publicInsight(record);
}

export async function saveInsightFeedback({ brandId, insightId, userId, useful, comment }, db = prisma) {
  await insightDetail(brandId, insightId, userId, db);
  return db.analyticsInsightFeedback.upsert({ where: { insightId_userId: { insightId, userId } },
    create: { insightId, userId, useful, comment }, update: { useful, comment },
    select: { useful: true, comment: true, updatedAt: true } });
}

export async function insightFeedbackStats(input, db = prisma) {
  const where = { insight: historyFilter(input) };
  const [groups, rejected] = await db.$transaction([
    db.analyticsInsightFeedback.groupBy({ by: ['useful'], where, _count: { _all: true } }),
    db.analyticsInsightFeedback.groupBy({ by: ['insightId'], where: { ...where, useful: false },
      _count: { _all: true }, orderBy: [{ _count: { insightId: 'desc' } }, { insightId: 'asc' }], take: 5 }),
  ]);
  const positive = groups.find((group) => group.useful)?._count._all ?? 0;
  const total = groups.reduce((sum, group) => sum + group._count._all, 0);
  return { total, positive, negative: total - positive, satisfactionRate: total ? round(positive / total * 100) : null,
    mostRejected: rejected.map((group) => ({ insightId: group.insightId, rejections: group._count._all })) };
}
