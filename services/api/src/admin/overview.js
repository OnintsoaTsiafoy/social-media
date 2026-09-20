import { prisma } from '../db/prisma.js';
import {
  accountFilter,
  bucketBounds,
  commentSentimentBuckets,
  escalationBuckets,
  periodWindows,
  providerOf,
  ratio,
  replyBuckets,
  sumReplyBuckets,
} from './metrics.js';
import { readSetting, SETTING_KEYS } from './settings.js';

const HOUR_MS = 3_600_000;
const SPARK_POINTS = 8;
const VOLUME_DAYS = 14;
const ONLINE_WINDOW_MINUTES = 20;

const deltaPercent = (current, previous) =>
  current === null || previous === null || previous === 0 ? null : ((current - previous) / previous) * 100;

export function resolveTimeZone(timezone) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

/** Les `days` derniers jours civils (AAAA-MM-JJ) dans le fuseau, du plus ancien au plus récent. */
export function recentDayKeys(timezone, days, now = new Date()) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return Array.from({ length: days }, (_, index) => format.format(new Date(now.getTime() - (days - 1 - index) * 24 * HOUR_MS)));
}

const analysed = (bucket) => bucket.positive + bucket.neutral + bucket.negative;

// --- Compteurs de la coque (barre latérale, barre du haut) -------------------

export async function adminSummary() {
  const now = new Date();
  const monthWindow = periodWindows('30d', now).current;
  const { value: levels } = await readSetting(SETTING_KEYS.serviceLevels);

  const [pages, users, online, pendingDrafts, openEscalations, needingAction, replies, lastComment] = await Promise.all([
    prisma.socialAccount.groupBy({ by: ['provider'], where: { status: { not: 'DISCONNECTED' } }, _count: { _all: true } }),
    prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.$queryRaw`
      SELECT COUNT(DISTINCT s.user_id)::int AS count
      FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'ACTIVE'
        AND COALESCE(s.last_used_at, s.created_at) > now() - make_interval(mins => ${ONLINE_WINDOW_MINUTES}::int)`,
    countPendingDrafts(),
    prisma.socialComment.count({ where: { status: 'ESCALATED' } }),
    prisma.socialAccount.count({ where: { status: { in: ['EXPIRING', 'EXPIRED', 'REAUTH_REQUIRED', 'REVOKED'] } } }),
    replyBuckets(monthWindow, 1, { slaSeconds: levels.firstResponseMinutes * 60 }),
    prisma.socialComment.aggregate({ _max: { createdAt: true } }),
  ]);

  const pageCount = (provider) => pages.find((row) => row.provider === provider)?._count._all ?? 0;
  const userCount = (status) => users.find((row) => row.status === status)?._count._all ?? 0;
  const month = sumReplyBuckets(replies);

  return {
    pages: { all: pageCount('FACEBOOK') + pageCount('INSTAGRAM'), facebook: pageCount('FACEBOOK'), instagram: pageCount('INSTAGRAM') },
    users: { total: userCount('ACTIVE') + userCount('DISABLED'), active: userCount('ACTIVE'), suspended: userCount('DISABLED'), online: online[0]?.count ?? 0 },
    supervision: { pendingDrafts, openEscalations },
    sla: { targetMinutes: levels.firstResponseMinutes, complianceRate: month.slaRate },
    ai: { autonomyRate: month.aiRate },
    alerts: { escalations: openEscalations, pagesNeedingAction: needingAction },
    lastEventAt: lastComment._max.createdAt?.toISOString() ?? null,
  };
}

/** Brouillons IA en attente de relecture : même définition que la file de supervision. */
export async function countPendingDrafts() {
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM response_suggestions rs
    JOIN social_comments c ON c.id = rs.comment_id
    WHERE rs.status IN ('PROPOSED', 'EDITED', 'FAILED') AND c.status = 'NEW'
      AND NOT EXISTS (SELECT 1 FROM response_suggestions n WHERE n.comment_id = rs.comment_id AND n.version > rs.version)`;
  return row?.count ?? 0;
}

// --- Vue d'ensemble -----------------------------------------------------------

export async function adminOverview({ period, network, timezone }) {
  const now = new Date();
  const { days, current, previous } = periodWindows(period, now);
  const filters = { network };
  const { value: levels } = await readSetting(SETTING_KEYS.serviceLevels);
  const slaSeconds = levels.firstResponseMinutes * 60;
  const tz = resolveTimeZone(timezone);

  const [
    commentsSpark,
    commentsPrevious,
    repliesSpark,
    repliesTotal,
    repliesPrevious,
    escalationSpark,
    escalationPrevious,
    daily,
    open,
    health,
    leaders,
    pages,
  ] = await Promise.all([
    commentSentimentBuckets(current, SPARK_POINTS, filters),
    commentSentimentBuckets(previous, 1, filters),
    replyBuckets(current, SPARK_POINTS, { ...filters, slaSeconds }),
    replyBuckets(current, 1, { ...filters, slaSeconds }),
    replyBuckets(previous, 1, { ...filters, slaSeconds }),
    escalationBuckets(current, SPARK_POINTS, filters),
    escalationBuckets(previous, 1, filters),
    dailySentiment(tz, network, now),
    openEscalations({ network, limit: 5 }),
    systemHealth(now),
    leaderboard(current, filters),
    pageTotals(),
  ]);

  const processed = commentsSpark.reduce((total, bucket) => total + analysed(bucket), 0);
  const processedPrevious = analysed(commentsPrevious[0]);
  const split = commentsSpark.reduce(
    (total, bucket) => ({
      positive: total.positive + bucket.positive,
      neutral: total.neutral + bucket.neutral,
      negative: total.negative + bucket.negative,
    }),
    { positive: 0, neutral: 0, negative: 0 }
  );
  const replyTotals = sumReplyBuckets(repliesTotal);
  const replyPrevious = sumReplyBuckets(repliesPrevious);
  const raised = escalationSpark.reduce((total, count) => total + count, 0);

  return {
    period,
    network,
    days,
    generatedAt: now.toISOString(),
    buckets: bucketBounds(current, SPARK_POINTS),
    pages,
    kpis: {
      processed: {
        value: processed,
        previous: processedPrevious,
        deltaPercent: deltaPercent(processed, processedPrevious),
        spark: commentsSpark.map(analysed),
      },
      firstResponse: {
        medianSeconds: repliesTotal[0].medianSeconds,
        previousMedianSeconds: repliesPrevious[0].medianSeconds,
        deltaPercent: deltaPercent(repliesTotal[0].medianSeconds, repliesPrevious[0].medianSeconds),
        spark: repliesSpark.map((bucket) => bucket.medianSeconds),
        targetMinutes: levels.firstResponseMinutes,
      },
      aiResolved: {
        rate: replyTotals.aiRate,
        previousRate: replyPrevious.aiRate,
        // Écart en points de pourcentage, pas en pourcentage relatif.
        deltaPoints:
          replyTotals.aiRate === null || replyPrevious.aiRate === null ? null : (replyTotals.aiRate - replyPrevious.aiRate) * 100,
        sentByAi: replyTotals.byAi,
        totalReplies: replyTotals.replies,
        spark: repliesSpark.map((bucket) => ratio(bucket.byAi, bucket.replies)),
      },
      escalations: {
        open: open.total,
        olderThanTwoHours: open.olderThanTwoHours,
        raised,
        raisedPrevious: escalationPrevious[0],
        spark: escalationSpark,
      },
    },
    sentiment: split,
    daily,
    health,
    escalations: open.items,
    leaderboard: leaders,
  };
}

/** Commentaires par jour civil (fuseau de l'administrateur) et par sentiment, sur 14 jours. */
async function dailySentiment(timezone, network, now) {
  const rows = await prisma.$queryRaw`
    SELECT to_char(c.created_at AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
           a.sentiment::text AS sentiment,
           COUNT(*)::int AS count
    FROM social_comments c
    JOIN social_accounts sa ON sa.id = c.social_account_id
    LEFT JOIN comment_analyses a ON a.id = c.latest_analysis_id
    WHERE c.created_at >= ${new Date(now.getTime() - (VOLUME_DAYS + 1) * 24 * HOUR_MS).toISOString()}::timestamptz
      ${accountFilter({ network })}
    GROUP BY 1, 2`;

  const columns = new Map(recentDayKeys(timezone, VOLUME_DAYS, now).map((date) => [date, { date, positive: 0, neutral: 0, negative: 0 }]));
  for (const row of rows) {
    const column = columns.get(row.day);
    // Un commentaire non analysé n'a pas de sentiment : il ne compte dans aucune barre.
    if (column && row.sentiment) column[row.sentiment.toLowerCase()] += row.count;
  }
  return [...columns.values()];
}

const SEVERITY_LEVELS = ['critical', 'high', 'medium'];

/** Urgence de l'analyse d'abord, puis priorité ; sans analyse, « medium » plutôt qu'une gravité inventée. */
export function severityOf(analysis) {
  if (analysis?.isUrgent) return SEVERITY_LEVELS[0];
  if (analysis?.priority === 'HIGH') return SEVERITY_LEVELS[1];
  return SEVERITY_LEVELS[2];
}

export async function openEscalations({ network = 'all', limit = 5 } = {}) {
  const provider = providerOf(network);
  const where = {
    status: 'ESCALATED',
    ...(provider ? { socialAccount: { provider } } : {}),
  };
  const twoHoursAgo = new Date(Date.now() - 2 * HOUR_MS);

  const [total, records] = await Promise.all([
    prisma.socialComment.count({ where }),
    prisma.socialComment.findMany({
      where,
      include: {
        socialAccount: { select: { name: true, provider: true } },
        latestAnalysis: { select: { isUrgent: true, priority: true } },
        // Dernière transition vers ESCALATED : date et auteur de l'escalade.
        statusHistory: {
          where: { toStatus: 'ESCALATED' },
          orderBy: { changedAt: 'desc' },
          take: 1,
          include: { changedByUser: { select: { displayName: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
  ]);

  const items = records.map((record) => {
    const escalation = record.statusHistory[0];
    return {
      id: record.id,
      network: record.socialAccount.provider.toLowerCase(),
      text: (record.content ?? '').slice(0, 200),
      page: record.socialAccount.name,
      raisedBy: escalation?.changedByUser?.displayName ?? null,
      raisedAt: (escalation?.changedAt ?? record.updatedAt).toISOString(),
      severity: severityOf(record.latestAnalysis),
    };
  });
  // Les plus graves d'abord, puis les plus anciennes : c'est l'ordre de traitement.
  items.sort(
    (a, b) => SEVERITY_LEVELS.indexOf(a.severity) - SEVERITY_LEVELS.indexOf(b.severity) || a.raisedAt.localeCompare(b.raisedAt)
  );

  return {
    total,
    olderThanTwoHours: items.filter((item) => new Date(item.raisedAt) < twoHoursAgo).length,
    items: items.slice(0, limit),
  };
}

/** Indicateurs bruts ; la console décide des seuils et des couleurs. */
async function systemHealth(now) {
  const since = new Date(now.getTime() - 24 * HOUR_MS).toISOString();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * HOUR_MS).toISOString();

  const [webhooks, backlog, expiring, connected] = await Promise.all([
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
             AVG(EXTRACT(EPOCH FROM (processed_at - received_at))::float8 * 1000)
               FILTER (WHERE processed_at IS NOT NULL) AS avg_latency_ms
      FROM webhook_events WHERE received_at >= ${since}::timestamptz`,
    prisma.socialComment.count({ where: { status: 'NEW' } }),
    prisma.$queryRaw`
      SELECT COUNT(DISTINCT sa.id)::int AS count
      FROM social_accounts sa
      LEFT JOIN oauth_tokens t ON t.social_account_id = sa.id AND t.status = 'ACTIVE'
      WHERE sa.status <> 'DISCONNECTED'
        AND (sa.status IN ('EXPIRING', 'EXPIRED', 'REAUTH_REQUIRED')
             OR t.expires_at < ${inSevenDays}::timestamptz)`,
    prisma.socialAccount.count({ where: { status: { not: 'DISCONNECTED' } } }),
  ]);

  const row = webhooks[0];
  return {
    webhooks: {
      total24h: row?.total ?? 0,
      failed24h: row?.failed ?? 0,
      averageLatencyMs: row?.avg_latency_ms === null || row?.avg_latency_ms === undefined ? null : Math.round(Number(row.avg_latency_ms)),
    },
    moderationBacklog: backlog,
    tokens: { expiringWithinSevenDays: expiring[0]?.count ?? 0, connectedPages: connected },
  };
}

async function leaderboard(window, filters) {
  const rows = await prisma.$queryRaw`
    SELECT u.id, u.display_name AS name, COUNT(*)::int AS replies
    FROM sent_responses sr
    JOIN users u ON u.id = sr.sent_by_user_id
    JOIN social_accounts sa ON sa.id = sr.social_account_id
    WHERE sr.status = 'SUCCEEDED'
      AND sr.finished_at >= ${window.from.toISOString()}::timestamptz
      AND sr.finished_at < ${window.to.toISOString()}::timestamptz
      ${accountFilter(filters)}
    GROUP BY u.id, u.display_name
    ORDER BY replies DESC, u.display_name ASC
    LIMIT 5`;
  return rows.map((row) => ({ userId: row.id, name: row.name, replies: row.replies }));
}

async function pageTotals() {
  const rows = await prisma.socialAccount.groupBy({
    by: ['provider'],
    where: { status: { not: 'DISCONNECTED' } },
    _count: { _all: true },
  });
  const count = (provider) => rows.find((row) => row.provider === provider)?._count._all ?? 0;
  return { all: count('FACEBOOK') + count('INSTAGRAM'), facebook: count('FACEBOOK'), instagram: count('INSTAGRAM') };
}

// --- Activité en direct -------------------------------------------------------

/** Question > négatif > positif : l'étiquette la plus utile à un administrateur d'abord. */
export function feedTagOf(analysis) {
  if (!analysis) return 'pending';
  if (analysis.sentiment === 'NEGATIVE') return 'negative';
  if (analysis.intent === 'QUESTION' || analysis.intent === 'INFO_REQUEST') return 'question';
  if (analysis.sentiment === 'POSITIVE') return 'positive';
  return 'neutral';
}

export async function adminLive({ network }) {
  const provider = providerOf(network);
  const accountWhere = provider ? { socialAccount: { provider } } : {};
  const since = new Date(Date.now() - HOUR_MS);

  const [lastHour, recent] = await Promise.all([
    prisma.socialComment.count({ where: { createdAt: { gte: since }, ...accountWhere } }),
    prisma.socialComment.findMany({
      where: accountWhere,
      include: {
        socialAccount: { select: { name: true, provider: true } },
        latestAnalysis: { select: { sentiment: true, intent: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
  ]);

  return {
    commentsLastHour: lastHour,
    generatedAt: new Date().toISOString(),
    feed: recent.map((comment) => ({
      id: comment.id,
      network: comment.socialAccount.provider.toLowerCase(),
      page: comment.socialAccount.name,
      text: (comment.content ?? '').slice(0, 140),
      tag: feedTagOf(comment.latestAnalysis),
      at: comment.createdAt.toISOString(),
    })),
  };
}
