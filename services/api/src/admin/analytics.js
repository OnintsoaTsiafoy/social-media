import { prisma } from '../db/prisma.js';
import { aggregateSnapshots, latestMetricsByTarget } from '../lib/socialMetrics.js';
import {
  accountFilter,
  bucketBounds,
  commentSentimentBuckets,
  periodWindows,
  providerOf,
  ratio,
  replyBuckets,
} from './metrics.js';
import { resolveTimeZone } from './overview.js';

// Points de la courbe : un par jour sur 7 jours, dix seaux sur 30 et 90 jours.
const POINTS_BY_PERIOD = { '7d': 7, '30d': 10, '90d': 10 };

export const METRIC_UNITS = {
  engagement: 'percent',
  response_time: 'seconds',
  sentiment: 'percent',
  ai_performance: 'percent',
};

/**
 * Valeur de la métrique dans chaque seau de la fenêtre : un nombre, ou `null`
 * quand rien ne permet de la calculer (aucune réponse envoyée, aucune analyse,
 * aucune publication…). `null` n'est jamais rendu comme 0 par la console.
 * Les taux sont des rapports 0–1 ; les délais sont en secondes.
 */
async function metricBuckets(window, buckets, { metric, sentiment, pageId, network }) {
  const filters = { network, pageId };

  if (metric === 'response_time') {
    const replies = await replyBuckets(window, buckets, { ...filters, sentiment });
    return replies.map((bucket) => bucket.medianSeconds);
  }
  if (metric === 'ai_performance') {
    const replies = await replyBuckets(window, buckets, { ...filters, sentiment });
    return replies.map((bucket) => ratio(bucket.byAi, bucket.replies));
  }
  if (metric === 'sentiment') {
    // La part du sentiment choisi parmi les commentaires analysés ; « tous » = positifs.
    const key = sentiment === 'all' ? 'positive' : sentiment;
    const comments = await commentSentimentBuckets(window, buckets, filters);
    return comments.map((bucket) => ratio(bucket[key], bucket.positive + bucket.neutral + bucket.negative));
  }
  return engagementBuckets(window, buckets, filters);
}

/**
 * Taux d'engagement des publications parues dans chaque seau. Même formule que
 * l'analytique mobile — `aggregateSnapshots` est le point d'entrée unique :
 * (réactions + commentaires + partages) / portée, `null` sans portée connue.
 */
async function engagementBuckets({ from, to }, buckets, { network, pageId }) {
  const provider = providerOf(network);
  const publications = await prisma.publication.findMany({
    where: {
      deletedAt: null,
      status: { in: ['PUBLISHED', 'PARTIALLY_PUBLISHED'] },
      publishedAt: { gte: from, lt: to },
    },
    select: {
      publishedAt: true,
      targets: {
        where: { ...(provider ? { provider } : {}), ...(pageId ? { socialAccountId: pageId } : {}) },
        select: { id: true },
      },
    },
  });

  const targetIds = publications.flatMap((publication) => publication.targets.map((target) => target.id));
  const metrics = await latestMetricsByTarget(targetIds);
  const step = (to.getTime() - from.getTime()) / buckets;
  const snapshotsByBucket = Array.from({ length: buckets }, () => []);

  for (const publication of publications) {
    const index = Math.min(buckets - 1, Math.floor((publication.publishedAt.getTime() - from.getTime()) / step));
    for (const target of publication.targets) snapshotsByBucket[index].push(metrics.get(target.id) ?? null);
  }
  return snapshotsByBucket.map((snapshots) => (snapshots.length === 0 ? null : aggregateSnapshots(snapshots).engagementRate));
}

export async function adminTrend({ metric, period, sentiment, pageId, network }) {
  const { current, previous } = periodWindows(period);
  const points = POINTS_BY_PERIOD[period];
  const options = { metric, sentiment, pageId, network };

  const [currentSeries, previousSeries, currentTotal, previousTotal] = await Promise.all([
    metricBuckets(current, points, options),
    metricBuckets(previous, points, options),
    metricBuckets(current, 1, options),
    metricBuckets(previous, 1, options),
  ]);

  const currentBounds = bucketBounds(current, points);
  const previousBounds = bucketBounds(previous, points);
  const delta =
    currentTotal[0] === null || previousTotal[0] === null || previousTotal[0] === 0
      ? null
      : ((currentTotal[0] - previousTotal[0]) / previousTotal[0]) * 100;

  return {
    metric,
    period,
    sentiment,
    unit: METRIC_UNITS[metric],
    points: currentBounds.map((bounds, index) => ({ ...bounds, value: currentSeries[index] })),
    previous: previousBounds.map((bounds, index) => ({ ...bounds, value: previousSeries[index] })),
    summary: { value: currentTotal[0], previousValue: previousTotal[0], deltaPercent: delta },
  };
}

// --- Performance par page ------------------------------------------------------

export async function adminPagesPerformance({ period, network, pageId, timezone }) {
  const { days, current } = periodWindows(period);
  const tz = resolveTimeZone(timezone);
  const provider = providerOf(network);
  const from = current.from.toISOString();
  const to = current.to.toISOString();

  const [accounts, options, commentRows, replyRows, hourRows] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { status: { not: 'DISCONNECTED' }, ...(provider ? { provider } : {}), ...(pageId ? { id: pageId } : {}) },
      select: { id: true, name: true, provider: true },
      orderBy: [{ name: 'asc' }, { provider: 'asc' }],
    }),
    prisma.socialAccount.findMany({
      where: { status: { not: 'DISCONNECTED' }, ...(provider ? { provider } : {}) },
      select: { id: true, name: true, provider: true },
      orderBy: [{ name: 'asc' }, { provider: 'asc' }],
    }),
    prisma.$queryRaw`
      SELECT sa.id AS account_id, a.sentiment::text AS sentiment, COUNT(*)::int AS count
      FROM social_comments c
      JOIN social_accounts sa ON sa.id = c.social_account_id
      LEFT JOIN comment_analyses a ON a.id = c.latest_analysis_id
      WHERE c.created_at >= ${from}::timestamptz AND c.created_at < ${to}::timestamptz
        ${accountFilter({ network, pageId })}
      GROUP BY 1, 2`,
    prisma.$queryRaw`
      SELECT sa.id AS account_id,
             COUNT(*)::int AS replies,
             percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (sr.finished_at - COALESCE(c.meta_created_at, c.created_at)))::float8
             ) AS median_seconds,
             COUNT(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM response_suggestions rs
               WHERE rs.comment_id = sr.comment_id AND rs.status = 'SENT' AND rs.generated_by_ai
             ))::int AS by_ai
      FROM sent_responses sr
      JOIN social_comments c ON c.id = sr.comment_id
      JOIN social_accounts sa ON sa.id = sr.social_account_id
      WHERE sr.status = 'SUCCEEDED'
        AND sr.finished_at >= ${from}::timestamptz AND sr.finished_at < ${to}::timestamptz
        AND sr.finished_at >= COALESCE(c.meta_created_at, c.created_at)
        ${accountFilter({ network, pageId })}
      GROUP BY 1`,
    prisma.$queryRaw`
      SELECT EXTRACT(HOUR FROM c.created_at AT TIME ZONE ${tz})::int AS hour, COUNT(*)::int AS count
      FROM social_comments c
      JOIN social_accounts sa ON sa.id = c.social_account_id
      WHERE c.created_at >= ${from}::timestamptz AND c.created_at < ${to}::timestamptz
        ${accountFilter({ network, pageId })}
      GROUP BY 1`,
  ]);

  const commentsByAccount = new Map();
  for (const row of commentRows) {
    const entry = commentsByAccount.get(row.account_id) ?? { total: 0, positive: 0, analysed: 0 };
    entry.total += row.count;
    if (row.sentiment) entry.analysed += row.count;
    if (row.sentiment === 'POSITIVE') entry.positive += row.count;
    commentsByAccount.set(row.account_id, entry);
  }
  const repliesByAccount = new Map(replyRows.map((row) => [row.account_id, row]));

  const hourly = Array.from({ length: 24 }, () => 0);
  for (const row of hourRows) if (row.hour >= 0 && row.hour < 24) hourly[row.hour] = row.count / days;

  return {
    period,
    pages: accounts.map((account) => {
      const comments = commentsByAccount.get(account.id) ?? { total: 0, positive: 0, analysed: 0 };
      const replies = repliesByAccount.get(account.id);
      return {
        id: account.id,
        name: account.name,
        network: account.provider.toLowerCase(),
        comments: comments.total,
        firstReplySeconds: replies?.median_seconds === undefined || replies?.median_seconds === null ? null : Number(replies.median_seconds),
        aiShare: replies ? ratio(replies.by_ai, replies.replies) : null,
        // Part de commentaires positifs parmi les analysés, en points 0–100.
        sentimentScore: comments.analysed > 0 ? Math.round((comments.positive / comments.analysed) * 100) : null,
      };
    }),
    options: options.map((account) => ({ id: account.id, name: account.name, network: account.provider.toLowerCase() })),
    hourly: hourly.map((average, hour) => ({ hour, average })),
  };
}
