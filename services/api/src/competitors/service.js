/**
 * Concurrents suivis par une marque : ajout, vérification, liste, suppression.
 *
 * Express ne parle jamais à Meta directement : la vérification d'un concurrent
 * passe par graph-api (`/internal/v1/competitors/profile`), et la collecte
 * périodique appartient au worker. Le seul appel réseau fait ici est donc
 * synchrone et volontaire : au moment où l'utilisateur ajoute un concurrent, il
 * attend une réponse — « compte trouvé » ou une raison — pas un 202.
 */

import { prisma } from '../db/prisma.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';
import { enqueueCompetitorSync } from '../lib/jobs.js';
import { callSocialService } from '../lib/socialServiceClient.js';
import { parseCompetitorHandle } from './schemas.js';

// Un compte encore utilisable pour interroger Meta. EXPIRING reste éligible :
// le token fonctionne toujours, c'est son renouvellement qui approche.
const USABLE_ACCOUNT_STATUSES = ['CONNECTED', 'EXPIRING'];

const NETWORK_LABELS = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram' };

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

export function periodRange(period, now = new Date()) {
  const to = now;
  const from = new Date(to.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000);
  return { from, to };
}

export function previousPeriodRange({ from, to }) {
  const durationMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - durationMs), to: from };
}

/**
 * Compte social de la marque au nom duquel Meta sera interrogé.
 *
 * Contrainte structurelle, pas un détail d'implémentation : Business Discovery
 * part obligatoirement du compte Instagram de la marque, et lire une Page
 * concurrente demande un token de Page réel. Sans compte connecté sur le
 * réseau visé, aucun concurrent de ce réseau n'est analysable — on le dit
 * plutôt que de laisser Meta répondre une erreur illisible.
 */
async function requireAccountFor(brandId, platform) {
  const provider = platform.toUpperCase();
  const account = await prisma.socialAccount.findFirst({
    where: { brandId, provider, status: { in: USABLE_ACCOUNT_STATUSES } },
    orderBy: { createdAt: 'asc' },
  });
  if (!account) {
    throw new HttpError(
      409,
      'conflict',
      `Connectez d’abord un compte ${NETWORK_LABELS[provider]} à cette marque : l’analyse d’un concurrent passe par ce compte.`
    );
  }
  return account;
}

export function toPublicCompetitor(competitor, { latestMetric } = {}) {
  return {
    id: competitor.id,
    brandId: competitor.brandId,
    platform: competitor.platform.toLowerCase(),
    externalId: competitor.externalId,
    username: competitor.username,
    name: competitor.name,
    profileUrl: competitor.profileUrl,
    avatarUrl: competitor.avatarUrl,
    status: competitor.status.toLowerCase(),
    lastSyncedAt: competitor.lastSyncedAt?.toISOString() ?? null,
    lastErrorCode: competitor.lastErrorCode,
    createdAt: competitor.createdAt.toISOString(),
    latestMetric: latestMetric ? toPublicMetric(latestMetric) : null,
  };
}

export function toPublicMetric(metric) {
  return {
    collectedAt: metric.collectedAt.toISOString(),
    followersCount: metric.followersCount,
    postsCount: metric.postsCount,
    reactionsCount: metric.reactionsCount,
    commentsCount: metric.commentsCount,
    sharesCount: metric.sharesCount,
    engagementRate: metric.engagementRate === null ? null : Number(metric.engagementRate),
  };
}

export function toPublicPost(post) {
  return {
    id: post.id,
    externalPostId: post.externalPostId,
    message: post.message,
    mediaType: post.mediaType,
    permalink: post.permalink,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    reactionsCount: post.reactionsCount,
    commentsCount: post.commentsCount,
    sharesCount: post.sharesCount,
    engagementRate: post.engagementRate === null ? null : Number(post.engagementRate),
    syncedAt: post.syncedAt.toISOString(),
  };
}

// Message destiné à l'utilisateur, dérivé du statut — jamais le texte d'erreur
// de Meta, en anglais et truffé de codes internes.
function reasonFor(status) {
  switch (status) {
    case 'ACTIVE':
      return null;
    case 'PERMISSION_REQUIRED':
      return 'Ce compte existe mais l’application n’a pas encore l’autorisation Meta nécessaire pour le lire.';
    case 'UNAVAILABLE':
      return 'Ce compte n’est pas analysable : il doit être un compte professionnel public existant.';
    default:
      return 'Meta n’a pas répondu pour ce compte. Réessayez dans quelques minutes.';
  }
}

export { reasonFor };

/**
 * Interroge Meta pour un concurrent sans rien enregistrer.
 *
 * Sert au bouton « Vérifier » de l'écran d'ajout et à l'ajout lui-même. Répond
 * toujours 200 : « ce compte n'est pas analysable » est une réponse, pas une
 * erreur — l'écran doit pouvoir l'afficher avec sa raison.
 */
export async function verifyCompetitor({ brandId, platform, handle }) {
  const account = await requireAccountFor(brandId, platform);

  const result = await callSocialService('/internal/v1/competitors/profile', {
    scope: 'social:read',
    body: { socialAccountId: account.id, platform: platform.toUpperCase(), handle },
  });

  const existing = await prisma.competitor.findFirst({
    where: { brandId, platform: platform.toUpperCase(), username: handle },
    select: { id: true },
  });

  return {
    status: result.status.toLowerCase(),
    platform,
    handle,
    externalId: result.externalId ?? null,
    username: (result.username ?? handle).toLowerCase(),
    name: result.name ?? null,
    profileUrl: result.profileUrl ?? null,
    avatarUrl: result.avatarUrl ?? null,
    accountType: result.accountType ?? null,
    followersCount: result.followersCount ?? null,
    postsCount: result.postsCount ?? null,
    unavailableFields: result.unavailableFields ?? [],
    reason: reasonFor(result.status),
    alreadyAdded: Boolean(existing),
    competitorId: existing?.id ?? null,
  };
}

export async function createCompetitor({ brandId, platform, handle, userId }, request) {
  const provider = platform.toUpperCase();

  // Doublon vérifié avant l'appel réseau : inutile de déranger Meta pour un
  // concurrent déjà suivi.
  const existing = await prisma.competitor.findFirst({
    where: { brandId, platform: provider, username: handle },
    select: { id: true },
  });
  if (existing) {
    throw new HttpError(409, 'conflict', 'Ce concurrent est déjà suivi pour cette marque.');
  }

  const verified = await verifyCompetitor({ brandId, platform, handle });

  // Un concurrent illisible n'est pas enregistré : le suivre ne produirait
  // jamais rien. Une permission manquante, si — c'est réparable par une App
  // Review, et le TODO demande d'en garder la trace.
  if (verified.status === 'unavailable') {
    throw new HttpError(409, 'conflict', verified.reason);
  }

  const status = verified.status.toUpperCase();
  const competitor = await prisma.competitor.create({
    data: {
      brandId,
      platform: provider,
      externalId: verified.externalId,
      // `handle` est déjà normalisé en minuscules par parseCompetitorHandle :
      // c'est lui, et non le nom renvoyé par Meta, qui porte l'unicité.
      username: handle,
      name: verified.name ?? verified.username,
      profileUrl: verified.profileUrl,
      avatarUrl: verified.avatarUrl,
      status,
      addedByUserId: userId,
      lastErrorCode: status === 'ACTIVE' ? null : status,
      lastErrorMessage: verified.reason,
    },
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'competitor.added',
    resourceType: 'competitor',
    resourceId: competitor.id,
    requestId: request.requestId,
    metadata: { brandId, platform, handle },
  });

  // Première collecte déclenchée tout de suite : l'écran de détail ne doit pas
  // rester vide jusqu'au prochain passage périodique. Une file injoignable ne
  // doit pas pour autant annuler l'ajout — le concurrent existe, la collecte se
  // fera au balayage suivant.
  const jobId = await enqueueCompetitorSync({ competitorId: competitor.id, requestedBy: userId }).catch((error) => {
    console.error({ scope: 'competitors', action: 'initial-sync', competitorId: competitor.id, error: error?.message });
    return null;
  });

  return { ...toPublicCompetitor(competitor), queued: jobId !== null, verification: verified };
}

export async function listCompetitors({ brandId, platform, status, page, pageSize }) {
  const where = {
    brandId,
    ...(platform === 'all' ? {} : { platform: platform.toUpperCase() }),
    ...(status === 'all' ? {} : { status: status.toUpperCase() }),
  };

  const [total, competitors] = await prisma.$transaction([
    prisma.competitor.count({ where }),
    prisma.competitor.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { metrics: { orderBy: { collectedAt: 'desc' }, take: 1 } },
    }),
  ]);

  return {
    items: competitors.map((competitor) => toPublicCompetitor(competitor, { latestMetric: competitor.metrics[0] })),
    page: { page, pageSize, total },
  };
}

/**
 * Charge un concurrent en vérifiant qu'il appartient bien à la marque déjà
 * autorisée par `requireBrandAccess`. Un identifiant appartenant à une autre
 * marque répond 404, jamais 403 : même règle que pour les marques elles-mêmes,
 * l'existence ne doit pas fuiter.
 */
export async function loadCompetitor(brandId, competitorId) {
  const competitor = await prisma.competitor.findFirst({
    where: { id: competitorId, brandId },
    include: { metrics: { orderBy: { collectedAt: 'desc' }, take: 1 } },
  });
  if (!competitor) throw new HttpError(404, 'not_found', 'Concurrent introuvable.');
  return competitor;
}

export async function getCompetitor(brandId, competitorId) {
  const competitor = await loadCompetitor(brandId, competitorId);
  const [storedPosts, storedMetrics] = await prisma.$transaction([
    prisma.competitorPost.count({ where: { competitorId } }),
    prisma.competitorMetric.count({ where: { competitorId } }),
  ]);
  return {
    ...toPublicCompetitor(competitor, { latestMetric: competitor.metrics[0] }),
    reason: competitor.status === 'ACTIVE' ? null : competitor.lastErrorMessage,
    storedPosts,
    storedMetrics,
  };
}

export async function updateCompetitor({ brandId, competitorId, name, handle, userId }, request) {
  const competitor = await loadCompetitor(brandId, competitorId);

  const data = {};
  if (name !== undefined) data.name = name;
  if (handle !== undefined) {
    let parsed;
    try {
      parsed = parseCompetitorHandle(competitor.platform.toLowerCase(), handle);
    } catch (error) {
      throw new HttpError(400, 'validation_failed', 'Les données envoyées ne sont pas valides.', [
        { field: 'handle', code: 'custom', message: error.message },
      ]);
    }
    if (parsed !== competitor.username) {
      const duplicate = await prisma.competitor.findFirst({
        where: { brandId, platform: competitor.platform, username: parsed, id: { not: competitorId } },
        select: { id: true },
      });
      if (duplicate) throw new HttpError(409, 'conflict', 'Ce concurrent est déjà suivi pour cette marque.');
      data.username = parsed;
      // Le compte visé change : l'identifiant Meta connu ne vaut plus rien et
      // le statut repart de zéro — la prochaine synchronisation tranchera.
      data.externalId = null;
      data.status = 'ACTIVE';
      data.lastErrorCode = null;
      data.lastErrorMessage = null;
    }
  }

  const updated = await prisma.competitor.update({ where: { id: competitorId }, data });

  await writeAuditLog(prisma, {
    userId,
    action: 'competitor.updated',
    resourceType: 'competitor',
    resourceId: competitorId,
    requestId: request.requestId,
    metadata: { brandId, changed: Object.keys(data) },
  });

  return toPublicCompetitor(updated);
}

export async function deleteCompetitor({ brandId, competitorId, userId }, request) {
  await loadCompetitor(brandId, competitorId);

  // Suppression physique, contrairement aux marques : un concurrent n'est pas
  // une ressource partagée dont l'historique doit survivre, et le TODO demande
  // simplement de pouvoir le retirer. Publications et relevés partent en
  // cascade.
  await prisma.competitor.delete({ where: { id: competitorId } });

  await writeAuditLog(prisma, {
    userId,
    action: 'competitor.removed',
    resourceType: 'competitor',
    resourceId: competitorId,
    requestId: request.requestId,
    metadata: { brandId },
  });
}

export async function requestCompetitorSync({ brandId, competitorId, userId }) {
  const competitor = await loadCompetitor(brandId, competitorId);
  const jobId = await enqueueCompetitorSync({ competitorId: competitor.id, requestedBy: userId });
  return { queued: jobId !== null, lastSyncedAt: competitor.lastSyncedAt?.toISOString() ?? null };
}

export async function listCompetitorPosts({ brandId, competitorId, period, page, pageSize }) {
  const competitor = await loadCompetitor(brandId, competitorId);
  const { from, to } = periodRange(period);

  const where = { competitorId: competitor.id, publishedAt: { gte: from, lt: to } };
  const [total, posts] = await prisma.$transaction([
    prisma.competitorPost.count({ where }),
    prisma.competitorPost.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: posts.map(toPublicPost),
    page: { page, pageSize, total },
    lastSyncedAt: competitor.lastSyncedAt?.toISOString() ?? null,
  };
}
