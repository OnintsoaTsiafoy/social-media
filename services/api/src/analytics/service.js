import { prisma } from '../db/prisma.js';
import { callAiService } from '../lib/aiServiceClient.js';
import { HttpError } from '../lib/http.js';
import { enqueueMetricsSync } from '../lib/jobs.js';
import { aggregateSnapshots, latestMetricsByTarget, sumInteractions } from '../lib/socialMetrics.js';
import { publicationInclude, toPublicPublications } from '../publications/service.js';
import { computeBestTimes, resolveWeekdayHour } from './bestTimes.js';

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

// Sprint 12 : les permissions manquantes qui rendent les indicateurs
// indisponibles pour de bon (pas seulement « pas encore synchronisé »).
// Noms exacts demandés à l'écran de consentement OAuth (Sprint 06,
// graph-api/modules/oauth/facebook_oauth.py::FACEBOOK_OAUTH_SCOPES) — décision
// Meta non revérifiée en direct dans cette session, comme le reste de ce fichier.
const METRICS_PERMISSION_BY_NETWORK = {
  FACEBOOK: 'pages_read_engagement',
  INSTAGRAM: 'instagram_business_manage_insights',
};

function periodRange(period) {
  const to = new Date();
  const from = new Date(to.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
  return { from, to };
}

// Même durée que la période demandée, immédiatement avant elle — sert de
// base aux deltas de /summary. Un delta n'est jamais affiché s'il vaut 0/0
// (voir summaryDeltas) : pas de « +100% » fabriqué à partir de rien.
function previousPeriodRange({ from, to }) {
  const durationMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - durationMs), to: from };
}

async function publicationsInScope({ brandId, network, from, to }) {
  return prisma.publication.findMany({
    where: {
      brandId,
      deletedAt: null,
      status: { in: ['PUBLISHED', 'PARTIALLY_PUBLISHED'] },
      publishedAt: { gte: from, lt: to },
    },
    include: {
      targets: network === 'all' ? true : { where: { provider: network.toUpperCase() } },
    },
    orderBy: { publishedAt: 'desc' },
  });
}

async function aggregateForPublications(publications) {
  const targetIds = publications.flatMap((publication) => publication.targets.map((target) => target.id));
  const metricsByTarget = await latestMetricsByTarget(targetIds);
  const snapshots = targetIds.map((id) => metricsByTarget.get(id) ?? null);
  return { aggregate: aggregateSnapshots(snapshots), metricsByTarget };
}

// Un accord (positif) n'est jamais affiché comme un delta négatif fabriqué à
// partir de zéro : sans donnée comparable sur la période précédente, pas de
// clé du tout — l'écran distingue « stable/en baisse » de « pas de référence ».
function computeDeltas(current, previous) {
  const deltas = {};
  for (const key of ['reactions', 'comments', 'engagementRate']) {
    if (current[key] === null || previous[key] === null || previous[key] === 0) continue;
    deltas[key] = ((current[key] - previous[key]) / previous[key]) * 100;
  }
  return deltas;
}

async function commentStatsForBrand({ brandId, network, from, to }) {
  const accountFilter = { brandId, ...(network === 'all' ? {} : { provider: network.toUpperCase() }) };
  const [negative, urgent, responsesGenerated, responsesSent] = await prisma.$transaction([
    prisma.socialComment.count({
      where: { socialAccount: accountFilter, createdAt: { gte: from, lt: to }, latestAnalysis: { is: { sentiment: 'NEGATIVE' } } },
    }),
    prisma.socialComment.count({
      where: { socialAccount: accountFilter, createdAt: { gte: from, lt: to }, latestAnalysis: { is: { isUrgent: true } } },
    }),
    // version: 1 = la première proposition générée pour un commentaire ; les
    // versions suivantes sont des réécritures du même échange, pas de
    // nouvelles générations.
    prisma.responseSuggestion.count({
      where: { version: 1, createdAt: { gte: from, lt: to }, comment: { socialAccount: accountFilter } },
    }),
    prisma.sentResponse.count({
      where: { status: 'SUCCEEDED', startedAt: { gte: from, lt: to }, socialAccount: accountFilter },
    }),
  ]);
  return { negative, urgent, responsesGenerated, responsesSent };
}

// « Non disponible parce que la permission manque » (résultat toujours
// null) est distinct de « pas encore synchronisé » (le cas normal juste
// après une publication) — seul le premier doit figurer ici. Vérifie chaque
// compte connecté du réseau demandé, pas seulement ceux avec des
// publications dans la période : une permission retirée reste pertinente
// même sans nouvelle publication récente.
async function unavailableLabels({ brandId, network }) {
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId, ...(network === 'all' ? {} : { provider: network.toUpperCase() }) },
    include: { permissions: true },
  });
  return accounts.map(unavailableLabelForAccount).filter(Boolean);
}

function unavailableLabelForAccount(account) {
  const requiredPermission = METRICS_PERMISSION_BY_NETWORK[account.provider];
  const declined = account.permissions.some(
    (permission) => permission.permission === requiredPermission && permission.status === 'DECLINED'
  );
  if (!declined) return null;
  const label = account.provider === 'FACEBOOK' ? 'Facebook' : 'Instagram';
  return `${label} : indicateurs indisponibles (permission manquante)`;
}

// Variante de unavailableLabels scopée à un jeu de comptes déjà connu (Jour 4
// — le détail d'une publication ne connaît que les comptes de ses propres
// cibles, pas tous les comptes de la marque).
async function unavailableLabelsForAccountIds(accountIds) {
  if (accountIds.length === 0) return [];
  const accounts = await prisma.socialAccount.findMany({ where: { id: { in: accountIds } }, include: { permissions: true } });
  return accounts.map(unavailableLabelForAccount).filter(Boolean);
}

export async function analyticsSummary({ brandId, period, network }) {
  const range = periodRange(period);
  const [{ aggregate }, previous, commentStats, unavailable] = await Promise.all([
    publicationsInScope({ brandId, network, ...range }).then(aggregateForPublications),
    publicationsInScope({ brandId, network, ...previousPeriodRange(range) })
      .then(aggregateForPublications)
      .then((result) => result.aggregate),
    commentStatsForBrand({ brandId, network, ...range }),
    unavailableLabels({ brandId, network }),
  ]);

  return {
    totals: {
      reactions: aggregate.reactions,
      comments: aggregate.comments,
      shares: aggregate.shares,
      reach: aggregate.reach,
      impressions: aggregate.impressions,
      engagementRate: aggregate.engagementRate,
      negativeComments: commentStats.negative,
      urgentComments: commentStats.urgent,
      responsesGenerated: commentStats.responsesGenerated,
      responsesSent: commentStats.responsesSent,
      deltas: computeDeltas(aggregate, previous),
    },
    lastSyncAt: aggregate.lastSyncedAt,
    unavailable,
  };
}

const TIMELINE_WEEKS = 4;
const frenchDayMonth = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });

// Fixée à 4 semaines glissantes, indépendamment du paramètre period des
// autres routes — l'écran analytics mobile affiche ce graphique sous le
// titre statique « 4 dernières semaines » (voir app/(tabs)/analytics.tsx),
// donc la fenêtre doit rester cohérente avec ce texte plutôt que de suivre
// 7j/30j/90j.
export async function analyticsTimeline({ brandId, network }) {
  const to = new Date();
  const from = new Date(to.getTime() - TIMELINE_WEEKS * 7 * 24 * 60 * 60 * 1000);
  const publications = await publicationsInScope({ brandId, network, from, to });
  const { metricsByTarget } = await aggregateForPublications(publications);

  const buckets = Array.from({ length: TIMELINE_WEEKS }, (_, index) => {
    const bucketFrom = new Date(from.getTime() + index * 7 * 24 * 60 * 60 * 1000);
    const bucketTo = new Date(bucketFrom.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { from: bucketFrom, to: bucketTo, label: frenchDayMonth.format(bucketFrom), facebook: 0, instagram: 0 };
  });

  for (const publication of publications) {
    const bucket = buckets.find((candidate) => publication.publishedAt >= candidate.from && publication.publishedAt < candidate.to);
    if (!bucket) continue;
    for (const target of publication.targets) {
      const snapshot = metricsByTarget.get(target.id);
      // Exception documentée (Jour 1) : contrairement à une carte métrique
      // individuelle, une barre hebdomadaire somme sur de nombreuses
      // publications — un relevé null n'y contribue simplement pas.
      const value = snapshot ? (snapshot.reactions ?? 0) + (snapshot.comments ?? 0) + (snapshot.shares ?? 0) : 0;
      const key = target.provider.toLowerCase();
      bucket[key] += value;
    }
  }

  return { interactions: buckets.map(({ label, facebook, instagram }) => ({ label, facebook, instagram })) };
}

export async function analyticsTopPublications({ brandId, period, network, limit }) {
  const range = periodRange(period);
  // Première passe légère (targets seuls) pour scorer et choisir les N
  // meilleures — inutile de charger media/brand/schedule pour l'ensemble des
  // publications de la période, seulement pour celles retenues.
  const publications = await publicationsInScope({ brandId, network, ...range });
  const { metricsByTarget } = await aggregateForPublications(publications);

  const topIds = publications
    .map((publication) => {
      const snapshots = publication.targets.map((target) => metricsByTarget.get(target.id) ?? null);
      const aggregate = aggregateSnapshots(snapshots);
      const score = (aggregate.reactions ?? 0) + (aggregate.comments ?? 0) + (aggregate.shares ?? 0);
      return { id: publication.id, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.id);

  if (topIds.length === 0) return { topPublications: [] };

  // toPublicPublications attend la forme complète (publicationInclude), pas
  // le sous-ensemble targets-only de la passe de score ci-dessus.
  const fullRecords = await prisma.publication.findMany({ where: { id: { in: topIds } }, include: publicationInclude });
  const byId = new Map(fullRecords.map((record) => [record.id, record]));
  const ordered = topIds.map((id) => byId.get(id)).filter(Boolean);

  return { topPublications: await toPublicPublications(ordered) };
}

export async function analyticsNetworksComparison({ brandId, period, network }) {
  const range = periodRange(period);
  const publications = await publicationsInScope({ brandId, network, ...range });
  const { metricsByTarget } = await aggregateForPublications(publications);

  const targetsByNetwork = { facebook: [], instagram: [] };
  for (const publication of publications) {
    for (const target of publication.targets) {
      targetsByNetwork[target.provider.toLowerCase()]?.push(metricsByTarget.get(target.id) ?? null);
    }
  }

  return {
    networks: Object.entries(targetsByNetwork).map(([provider, snapshots]) => ({
      network: provider,
      ...aggregateSnapshots(snapshots),
    })),
  };
}

// Sprint 12 Jour 4. brandId est déjà vérifié par requireBrandAccess côté
// route ; ce findFirst re-vérifie que publicationId appartient bien à CETTE
// marque (jamais 403 : une publication d'une autre marque doit être
// indiscernable d'une publication inexistante, même convention que
// comments/middleware.js::loadComment).
export async function publicationAnalytics(publicationId, brandId) {
  const publication = await prisma.publication.findFirst({
    where: { id: publicationId, brandId, deletedAt: null },
    include: publicationInclude,
  });
  if (!publication) throw new HttpError(404, 'not_found', 'Publication introuvable.');

  const [publicPublication, metricsByTarget] = await Promise.all([
    toPublicPublications([publication]).then((records) => records[0]),
    latestMetricsByTarget(publication.targets.map((target) => target.id)),
  ]);

  const perNetwork = publication.targets.map((target) => ({
    network: target.provider.toLowerCase(),
    reactions: metricsByTarget.get(target.id)?.reactions ?? null,
  }));

  const accountIds = [...new Set(publication.targets.map((target) => target.socialAccountId).filter(Boolean))];
  const pairs = publication.targets
    .filter((target) => target.socialAccountId && target.externalPublicationId)
    .map((target) => ({ socialAccountId: target.socialAccountId, externalPublicationId: target.externalPublicationId }));

  const comments =
    pairs.length === 0
      ? []
      : await prisma.socialComment.findMany({
          where: { OR: pairs },
          select: { id: true, latestAnalysis: { select: { sentiment: true, isUrgent: true } } },
        });

  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  let urgentCount = 0;
  for (const comment of comments) {
    if (!comment.latestAnalysis) continue;
    sentiment[comment.latestAnalysis.sentiment.toLowerCase()] += 1;
    if (comment.latestAnalysis.isUrgent) urgentCount += 1;
  }

  const commentIds = comments.map((comment) => comment.id);
  const [responsesGenerated, responsesSent, unavailable] = await Promise.all([
    commentIds.length === 0
      ? 0
      : prisma.responseSuggestion.count({ where: { version: 1, commentId: { in: commentIds } } }),
    commentIds.length === 0 ? 0 : prisma.sentResponse.count({ where: { status: 'SUCCEEDED', commentId: { in: commentIds } } }),
    unavailableLabelsForAccountIds(accountIds),
  ]);

  return {
    publication: publicPublication,
    perNetwork,
    sentiment,
    urgent: urgentCount,
    responsesGenerated,
    responsesSent,
    unavailable,
  };
}

async function analysisGroupCounts({ brandId, network, from, to, groupBy }) {
  const rows = await prisma.commentAnalysis.groupBy({
    by: [groupBy],
    where: {
      // Seule l'analyse courante d'un commentaire compte : une version
      // remplacée par une réanalyse ne doit pas peser deux fois dans le total.
      latestForComment: { isNot: null },
      analysedAt: { gte: from, lt: to },
      comment: { socialAccount: { brandId, ...(network === 'all' ? {} : { provider: network.toUpperCase() }) } },
    },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row[groupBy].toLowerCase(), row._count._all]));
}

export async function analyticsSentiments({ brandId, period, network }) {
  const range = periodRange(period);
  const byLabel = await analysisGroupCounts({ brandId, network, ...range, groupBy: 'sentiment' });
  return { sentiment: { positive: byLabel.positive ?? 0, neutral: byLabel.neutral ?? 0, negative: byLabel.negative ?? 0 } };
}

export async function analyticsPriorities({ brandId, period, network }) {
  const range = periodRange(period);
  const byLabel = await analysisGroupCounts({ brandId, network, ...range, groupBy: 'priority' });
  return { priority: { low: byLabel.low ?? 0, medium: byLabel.medium ?? 0, high: byLabel.high ?? 0 } };
}

// Sprint 12 Jour 2 : ne fait qu'empiler un job pg-boss sur la même file que
// la reprise périodique du worker (voir services/worker/index.js) — jamais
// d'appel direct à graph-api ici, contrairement à syncBrandComments
// (comments/service.js). C'est ce qui garantit que les lectures Express
// (summary/timeline/... ci-dessus, dashboard) ne peuvent jamais, même
// indirectement, déclencher une synchronisation lourde : seule cette route
// enqueue quoi que ce soit.
export async function syncBrandMetrics({ brandId, requestedBy }) {
  const jobId = await enqueueMetricsSync({ brandId, requestedBy });
  return { queued: jobId !== null };
}

// Recommandation du meilleur horaire (sprint_listing/PLUS/
// TODO_RECOMMANDATION_MEILLEUR_HORAIRE.md). `network` est déjà restreint à
// facebook/instagram par bestTimesQuerySchema — publicationsInScope gère donc
// toujours la branche "un seul réseau", jamais `all`.
export async function analyticsBestTimes({ brandId, network, period, timezone }) {
  const range = periodRange(period);
  const publications = await publicationsInScope({ brandId, network, ...range });
  const targetIds = publications.flatMap((publication) => publication.targets.map((target) => target.id));
  const metricsByTarget = await latestMetricsByTarget(targetIds);

  const rows = [];
  for (const publication of publications) {
    const { weekday, hour } = resolveWeekdayHour(publication.publishedAt, timezone);
    for (const target of publication.targets) {
      const snapshot = metricsByTarget.get(target.id) ?? null;
      const aggregate = aggregateSnapshots([snapshot]);
      rows.push({
        weekday,
        hour,
        engagementRate: aggregate.engagementRate,
        reach: aggregate.reach,
        interactions: sumInteractions(aggregate),
      });
    }
  }

  return { network, period, timezone, ...computeBestTimes(rows) };
}

const BEST_TIMES_INSUFFICIENT_DATA_TEXT =
  'Pas assez de publications publiées avec des statistiques suffisantes sur cette période pour ' +
  'proposer un horaire recommandé. Publiez régulièrement puis réessayez une fois les statistiques disponibles.';

// Les chiffres viennent toujours de `analyticsBestTimes`, jamais du client
// (voir routes.js : /best-times/explain recalcule les faits côté serveur à
// partir des mêmes paramètres plutôt que de faire confiance à un payload
// envoyé par le mobile) — c'est ce qui permet à ai-service de promettre de ne
// jamais inventer un chiffre absent de ce qu'on lui envoie.
export async function explainBestTimes({ brandId, network, period, timezone }) {
  const facts = await analyticsBestTimes({ brandId, network, period, timezone });

  if (facts.status === 'insufficient_data') {
    return { text: BEST_TIMES_INSUFFICIENT_DATA_TEXT, generator: 'insufficient-data', generatedAt: new Date().toISOString() };
  }

  const result = await callAiService('/internal/v1/analytics/best-times/explain', {
    scope: 'ai:generate',
    body: {
      network: facts.network,
      period: facts.period,
      analyzedCount: facts.analyzedCount,
      best: facts.best,
      alternatives: facts.alternatives,
    },
  });

  return { text: result.text, generator: result.generator, generatedAt: new Date().toISOString() };
}
