/**
 * Indicateurs concurrentiels et comparaison avec la marque active
 * (sections 8 et 10 du TODO analyse concurrentielle).
 *
 * Ce fichier fait la lecture Prisma et la mise en forme ; tout le calcul est
 * dans `indicators.js`, qui n'a aucune dépendance. La séparation compte ici
 * plus qu'ailleurs : c'est elle qui rend les règles de comparabilité testables
 * sans base de données.
 *
 * Le point délicat du rapprochement marque/concurrent est la normalisation.
 * Nos publications vivent dans `publications` + `publication_targets` +
 * `social_metrics` (un relevé historisé par cible) ; celles d'un concurrent
 * dans `competitor_posts` (un compteur par publication). `brandPosts()` ramène
 * les premières à la forme des secondes — une publication par cible, avec ses
 * compteurs — pour que `computeIndicators` applique littéralement le même
 * calcul des deux côtés.
 */

import { prisma } from '../db/prisma.js';
import { callAiService } from '../lib/aiServiceClient.js';
import { HttpError } from '../lib/http.js';
import { latestMetricsByTarget } from '../lib/socialMetrics.js';
import { commonComponents, compare, computeIndicators } from './indicators.js';
import { loadCompetitor, periodRange, previousPeriodRange } from './service.js';

const NETWORK_LABELS = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram' };

/**
 * Nos publications envoyées sur `provider` pendant la fenêtre, ramenées à la
 * forme d'une publication concurrente.
 *
 * Une cible par ligne, et non une publication : un même brouillon envoyé sur
 * Facebook et Instagram produit deux publications réelles, chacune avec ses
 * compteurs — les fusionner fausserait la fréquence comme les moyennes.
 */
export async function brandPosts({ brandId, provider, from, to }) {
  const publications = await prisma.publication.findMany({
    where: {
      brandId,
      deletedAt: null,
      status: { in: ['PUBLISHED', 'PARTIALLY_PUBLISHED'] },
      publishedAt: { gte: from, lt: to },
    },
    include: { targets: { where: { provider, status: 'SENT' } } },
    orderBy: { publishedAt: 'desc' },
  });

  const targets = publications.flatMap((publication) =>
    publication.targets.map((target) => ({ publication, target }))
  );
  const metricsByTarget = await latestMetricsByTarget(targets.map(({ target }) => target.id));

  return targets.map(({ publication, target }) => {
    const snapshot = metricsByTarget.get(target.id) ?? null;
    return {
      externalPostId: target.externalPublicationId ?? target.id,
      publicationId: publication.id,
      message: target.adaptedContent ?? publication.content,
      mediaType: null,
      permalink: null,
      publishedAt: (target.sentAt ?? publication.publishedAt)?.toISOString() ?? null,
      reactionsCount: snapshot?.reactions ?? null,
      commentsCount: snapshot?.comments ?? null,
      sharesCount: snapshot?.shares ?? null,
    };
  });
}

/** Abonnés du compte de la marque sur ce réseau, relevés par la passe
 * concurrents (voir worker/src/competitor-sync.js). `null` tant qu'aucune
 * passe n'a eu lieu ou que Meta ne les rend pas. */
export async function brandFollowers({ brandId, provider }) {
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId, provider, status: { in: ['CONNECTED', 'EXPIRING'] } },
    select: { followersCount: true, followersSyncedAt: true },
  });
  const known = accounts.filter((account) => account.followersCount !== null);
  if (known.length === 0) return { followersCount: null, followersSyncedAt: null };
  return {
    // Plusieurs comptes du même réseau sur une marque : l'audience cumulée est
    // le seul total qui ait un sens face à un concurrent unique.
    followersCount: known.reduce((total, account) => total + account.followersCount, 0),
    followersSyncedAt:
      known
        .map((account) => account.followersSyncedAt)
        .filter(Boolean)
        .sort((a, b) => b.getTime() - a.getTime())[0]
        ?.toISOString() ?? null,
  };
}

async function competitorPosts({ competitorId, from, to }) {
  const posts = await prisma.competitorPost.findMany({
    where: { competitorId, publishedAt: { gte: from, lt: to } },
    orderBy: { publishedAt: 'desc' },
  });
  return posts.map((post) => ({
    externalPostId: post.externalPostId,
    message: post.message,
    mediaType: post.mediaType,
    permalink: post.permalink,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    reactionsCount: post.reactionsCount,
    commentsCount: post.commentsCount,
    sharesCount: post.sharesCount,
  }));
}

/** Abonnés du concurrent au dernier relevé connu. Conservé même périmé : le
 * TODO demande explicitement de garder la dernière donnée connue avec sa date
 * plutôt que d'afficher un vide (section 11). */
async function competitorFollowers(competitorId) {
  const metric = await prisma.competitorMetric.findFirst({
    where: { competitorId, followersCount: { not: null } },
    orderBy: { collectedAt: 'desc' },
  });
  return {
    followersCount: metric?.followersCount ?? null,
    followersSyncedAt: metric?.collectedAt?.toISOString() ?? null,
  };
}

/** Âge au-delà duquel une donnée conservée est signalée comme ancienne
 * (section 11). Deux fois l'intervalle du balayage quotidien : en dessous, un
 * simple décalage d'exécution déclencherait l'avertissement pour rien. */
const STALE_AFTER_HOURS = 48;

function stalenessWarning(label, isoDate) {
  if (!isoDate) return null;
  const ageHours = (Date.now() - new Date(isoDate).getTime()) / 3_600_000;
  if (ageHours < STALE_AFTER_HOURS) return null;
  return `${label} : dernière synchronisation il y a ${Math.floor(ageHours / 24)} jour(s).`;
}

/**
 * Indicateurs d'un concurrent seul (`GET /competitors/:id/analytics`).
 */
export async function competitorAnalytics({ brandId, competitorId, period, timezone = 'Europe/Paris' }) {
  const competitor = await loadCompetitor(brandId, competitorId);
  const range = periodRange(period);
  const previous = previousPeriodRange(range);

  const [posts, previousPosts, followers, history] = await Promise.all([
    competitorPosts({ competitorId, ...range }),
    competitorPosts({ competitorId, ...previous }),
    competitorFollowers(competitorId),
    prisma.competitorMetric.findMany({
      where: { competitorId, collectedAt: { gte: range.from } },
      orderBy: { collectedAt: 'asc' },
    }),
  ]);

  const indicators = computeIndicators({
    posts,
    previousPosts,
    followersCount: followers.followersCount,
    from: range.from,
    to: range.to,
    timezone,
  });

  const staleness = stalenessWarning('Données du concurrent', competitor.lastSyncedAt?.toISOString() ?? null);

  return {
    competitor: {
      id: competitor.id,
      platform: competitor.platform.toLowerCase(),
      username: competitor.username,
      name: competitor.name,
      avatarUrl: competitor.avatarUrl,
      profileUrl: competitor.profileUrl,
      status: competitor.status.toLowerCase(),
      lastSyncedAt: competitor.lastSyncedAt?.toISOString() ?? null,
    },
    period,
    indicators,
    followersSyncedAt: followers.followersSyncedAt,
    // Évolution brute des relevés successifs : l'écran en fait une courbe, il
    // ne la recalcule pas.
    history: history.map((metric) => ({
      collectedAt: metric.collectedAt.toISOString(),
      followersCount: metric.followersCount,
      postsCount: metric.postsCount,
      engagementRate: metric.engagementRate === null ? null : Number(metric.engagementRate),
    })),
    topPosts: posts
      .map((post) => ({ ...post, interactions: sumKnown(post) }))
      .filter((post) => post.interactions !== null)
      .sort((a, b) => b.interactions - a.interactions)
      .slice(0, 3),
    warnings: [...indicators.warnings, staleness].filter(Boolean),
  };
}

function sumKnown(post) {
  const values = [post.reactionsCount, post.commentsCount, post.sharesCount];
  if (values.every((value) => value === null || value === undefined)) return null;
  return values.reduce((total, value) => total + (value ?? 0), 0);
}

/**
 * Comparaison de la marque avec ses concurrents (`GET /competitors/comparison`).
 *
 * Un concurrent est comparé réseau par réseau, jamais tous réseaux confondus :
 * la marque n'a pas la même audience ni les mêmes usages sur Facebook et
 * Instagram, et un concurrent n'existe que sur un seul des deux.
 */
export async function competitorsComparison({ brandId, period, platform, limit, timezone = 'Europe/Paris' }) {
  const range = periodRange(period);
  const previous = previousPeriodRange(range);

  const competitors = await prisma.competitor.findMany({
    where: { brandId, ...(platform === 'all' ? {} : { platform: platform.toUpperCase() }) },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  // Les publications de la marque sont chargées une fois par réseau présent
  // parmi les concurrents retenus, pas une fois par concurrent.
  const providers = [...new Set(competitors.map((competitor) => competitor.platform))];
  const brandSides = new Map();
  for (const provider of providers) {
    const [posts, previousPosts, followers] = await Promise.all([
      brandPosts({ brandId, provider, ...range }),
      brandPosts({ brandId, provider, ...previous }),
      brandFollowers({ brandId, provider }),
    ]);
    brandSides.set(provider, { posts, previousPosts, followers });
  }

  const comparisons = [];
  const warnings = [];

  for (const competitor of competitors) {
    const brandSide = brandSides.get(competitor.platform);
    const [posts, previousPosts, followers] = await Promise.all([
      competitorPosts({ competitorId: competitor.id, ...range }),
      competitorPosts({ competitorId: competitor.id, ...previous }),
      competitorFollowers(competitor.id),
    ]);

    // Le cœur de la règle « ne pas comparer deux métriques calculées
    // différemment » : les deux jeux d'indicateurs sont recalculés sur les
    // seules composantes que les deux côtés possèdent.
    const components = commonComponents(brandSide.posts, posts);

    const brandIndicators = computeIndicators({
      posts: brandSide.posts,
      previousPosts: brandSide.previousPosts,
      followersCount: brandSide.followers.followersCount,
      from: range.from,
      to: range.to,
      timezone,
      components,
    });
    const competitorIndicators = computeIndicators({
      posts,
      previousPosts,
      followersCount: followers.followersCount,
      from: range.from,
      to: range.to,
      timezone,
      components,
    });

    const excluded = ['reactions', 'comments', 'shares'].filter((component) => !components.includes(component));
    const notes = [];
    if (excluded.length > 0) {
      notes.push(
        `Interactions comparées hors ${excluded.map(componentLabel).join(', ')} : cette donnée manque d’un côté au moins.`
      );
    }
    if (brandSide.followers.followersCount === null) {
      notes.push('Abonnés de la marque non relevés : le taux d’engagement n’est pas comparable.');
    }
    if (followers.followersCount === null) {
      notes.push('Abonnés du concurrent non disponibles via Meta : le taux d’engagement n’est pas comparable.');
    }
    const staleness = stalenessWarning(competitor.name, competitor.lastSyncedAt?.toISOString() ?? null);
    if (staleness) notes.push(staleness);
    if (competitor.status !== 'ACTIVE') {
      notes.push(
        `Dernières données connues conservées : ce concurrent est actuellement ${statusLabel(competitor.status)}.`
      );
    }

    comparisons.push({
      competitor: {
        id: competitor.id,
        platform: competitor.platform.toLowerCase(),
        username: competitor.username,
        name: competitor.name,
        avatarUrl: competitor.avatarUrl,
        status: competitor.status.toLowerCase(),
        lastSyncedAt: competitor.lastSyncedAt?.toISOString() ?? null,
      },
      network: NETWORK_LABELS[competitor.platform],
      interactionComponents: components,
      brand: brandIndicators,
      competitorIndicators,
      metrics: compare(brandIndicators, competitorIndicators),
      topPosts: {
        brand: brandIndicators.topPost,
        competitor: competitorIndicators.topPost,
      },
      notes,
    });
  }

  if (competitors.length === 0) {
    warnings.push('Aucun concurrent suivi pour cette marque.');
  }

  return {
    period,
    platform,
    periodStart: range.from.toISOString(),
    periodEnd: range.to.toISOString(),
    comparisons,
    warnings,
  };
}

function componentLabel(component) {
  return { reactions: 'réactions', comments: 'commentaires', shares: 'partages' }[component] ?? component;
}

function statusLabel(status) {
  return {
    UNAVAILABLE: 'inaccessible via Meta',
    PERMISSION_REQUIRED: 'en attente d’autorisation Meta',
    SYNC_ERROR: 'en erreur de synchronisation',
  }[status] ?? 'actif';
}

/**
 * Résumé en langage naturel de la comparaison (section 10).
 *
 * L'IA ne calcule rien : elle reçoit les chiffres déjà calculés ci-dessus et
 * n'a le droit d'écrire que ceux-là — le service d'analyse rejette lui-même
 * toute sortie contenant un nombre absent des faits transmis. Les valeurs
 * envoyées sont conservées dans la réponse (`facts`) pour que l'explication
 * reste vérifiable après coup.
 */
export async function explainComparison({ brandId, period, platform, limit, timezone }, request) {
  const comparison = await competitorsComparison({ brandId, period, platform, limit, timezone });

  if (comparison.comparisons.length === 0) {
    throw new HttpError(409, 'conflict', 'Ajoutez au moins un concurrent avant de demander une analyse.');
  }

  const facts = toAiFacts(comparison);
  const response = await callAiService('/internal/v1/analytics/competitors/explain', {
    scope: 'ai:generate',
    body: facts,
    requestId: request?.requestId,
  });

  return {
    period,
    platform,
    text: response.text,
    recommendations: response.recommendations ?? [],
    generator: response.generator,
    warnings: [...(response.warnings ?? []), ...comparison.warnings],
    facts,
  };
}

/**
 * Charge utile envoyée au service IA : uniquement des métriques calculées,
 * aucune donnée brute, aucune valeur absente. Une métrique indisponible est
 * omise plutôt que transmise à `null` — le modèle ne peut pas commenter ce
 * qu'il ne voit pas, ce qui est exactement l'effet recherché.
 */
export function toAiFacts(comparison) {
  return {
    period: comparison.period,
    periodStart: comparison.periodStart,
    periodEnd: comparison.periodEnd,
    competitors: comparison.comparisons.map((entry) => ({
      name: entry.competitor.name,
      network: entry.network,
      postsCount: entry.competitorIndicators.postsCount,
      brandPostsCount: entry.brand.postsCount,
      interactionComponents: entry.interactionComponents,
      metrics: entry.metrics
        .filter((metric) => metric.availability === 'available')
        .map((metric) => ({
          key: metric.key,
          label: metric.label,
          unit: metric.unit,
          brand: metric.brand,
          competitor: metric.competitor,
          differencePercent: metric.differencePercent,
        })),
      unavailableMetrics: entry.metrics
        .filter((metric) => metric.availability !== 'available')
        .map((metric) => metric.label),
      notes: entry.notes,
    })),
  };
}
