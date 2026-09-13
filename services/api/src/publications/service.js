import {
  canDelete,
  canEditContent,
  canPublish,
  canSchedule,
  computePublicationStatus,
} from '../../../shared/publication-status.js';
import { commentStatsForPublications } from '../comments/service.js';
import { prisma } from '../db/prisma.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';
import { QUEUES, cancelJob, enqueuePublishNow, enqueueRetry, enqueueScheduledPublish } from '../lib/jobs.js';
import { aggregateSnapshots, latestMetricsByTarget } from '../lib/socialMetrics.js';
import { attachMediaToPublication, detachMediaFromPublication, toPublicMedia } from '../media/service.js';

export const publicationInclude = {
  brand: { select: { id: true, name: true } },
  createdBy: { select: { displayName: true, firstName: true, lastName: true } },
  targets: {
    orderBy: { provider: 'asc' },
    include: { socialAccount: { select: { name: true, username: true } } },
  },
  media: { include: { media: true }, orderBy: { position: 'asc' } },
  schedule: true,
};

function asStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

// Sprint 12 : metrics/commentCount ne sont plus des placeholders. Batché sur
// toute une liste (pas un aller-retour par publication) — voir
// latestMetricsByTarget/commentStatsForPublications, tous deux déjà pensés
// pour prendre une liste d'identifiants en une seule requête. Les appels
// list/calendar ci-dessous, qui rendent jusqu'à 500 publications, feraient
// sinon un N+1 sur social_metrics ET social_comments à chaque appel.
export async function toPublicPublications(records) {
  const targetIds = records.flatMap((record) => record.targets.map((target) => target.id));
  const publicationIds = records.map((record) => record.id);
  const [metricsByTarget, commentStats] = await Promise.all([
    latestMetricsByTarget(targetIds),
    commentStatsForPublications(publicationIds),
  ]);
  return Promise.all(records.map((record) => buildPublicPublication(record, metricsByTarget, commentStats)));
}

export async function toPublicPublication(record) {
  const [result] = await toPublicPublications([record]);
  return result;
}

async function buildPublicPublication(record, metricsByTarget, commentStats) {
  const media = await Promise.all(record.media.map((link) => toPublicMedia(link.media)));
  const aggregate = aggregateSnapshots(record.targets.map((target) => metricsByTarget.get(target.id) ?? null));
  const stats = commentStats.get(record.id) ?? { total: 0, negative: 0, urgent: 0 };

  return {
    id: record.id,
    brandId: record.brandId,
    brandName: record.brand?.name ?? '',
    content: record.content,
    language: record.language,
    hashtags: asStringList(record.hashtags),
    status: record.status.toLowerCase(),
    media,
    targets: record.targets.map((target) => ({
      provider: target.provider.toLowerCase(),
      socialAccountId: target.socialAccountId,
      // Sprint 06: null until the target is linked to a real social_accounts
      // row (older rows, or a provider with no account picked yet).
      accountUsername: target.socialAccount?.username ?? target.socialAccount?.name ?? null,
      status: target.status.toLowerCase(),
      adaptedContent: target.adaptedContent,
      adaptedHashtags: asStringList(target.adaptedHashtags),
      externalPublicationId: target.externalPublicationId,
      lastErrorCode: target.lastErrorCode,
      lastErrorMessage: target.lastErrorMessage,
      attemptCount: target.attemptCount,
      sentAt: target.sentAt,
    })),
    authorName: record.createdBy?.displayName ?? record.createdBy?.firstName ?? '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    scheduledAt: record.scheduledAt,
    publishedAt: record.publishedAt,
    timezone: record.timezone,
    schedule: record.schedule
      ? {
          scheduledAt: record.schedule.scheduledAt,
          timezone: record.schedule.timezone,
          status: record.schedule.status.toLowerCase(),
        }
      : null,
    metrics: {
      reactions: aggregate.reactions,
      comments: aggregate.comments,
      shares: aggregate.shares,
      reach: aggregate.reach,
      impressions: aggregate.impressions,
      engagementRate: aggregate.engagementRate,
      lastSyncAt: aggregate.lastSyncedAt,
    },
    commentCount: stats.total,
    negativeCommentCount: stats.negative,
    urgentCommentCount: stats.urgent,
  };
}

async function loadPublicPublication(publicationId) {
  const record = await prisma.publication.findFirst({
    where: { id: publicationId, deletedAt: null },
    include: publicationInclude,
  });
  if (!record) throw new HttpError(404, 'not_found', 'Publication introuvable.');
  return toPublicPublication(record);
}

// The mobile composer only lets a CM pick a provider (facebook/instagram),
// not a specific account (Sprint 06/07 scope boundary — see ComposerForm.tsx,
// no per-account picker UI yet). When the client omits socialAccountId, this
// resolves it automatically as long as the brand has exactly one connected
// account for that provider; with zero or several, it's left null (falls
// back to the Sprint 05 legacy single-Page behavior in graph-api, or — once
// a real picker exists — an explicit choice).
async function resolveSocialAccountId(brandId, provider, explicitId) {
  if (explicitId) {
    const account = await prisma.socialAccount.findFirst({
      where: { id: explicitId, brandId, provider: provider.toUpperCase() },
    });
    if (!account) {
      throw new HttpError(400, 'validation_failed', 'Ce compte social n’appartient pas à cette marque ou ce réseau.');
    }
    return account.id;
  }

  const candidates = await prisma.socialAccount.findMany({
    where: { brandId, provider: provider.toUpperCase(), status: { in: ['CONNECTED', 'EXPIRING'] } },
    select: { id: true },
  });
  return candidates.length === 1 ? candidates[0].id : null;
}

async function targetData(brandId, target) {
  const provider = target.provider.toUpperCase();
  return {
    provider,
    socialAccountId: await resolveSocialAccountId(brandId, target.provider, target.socialAccountId),
    adaptedContent: target.adaptedContent ?? null,
    adaptedHashtags: target.adaptedHashtags ?? [],
  };
}

/** Filtre commun : une publication n'est lisible que par un membre de sa marque. */
function accessibleWhere(userId, filters = {}) {
  return {
    deletedAt: null,
    brand: {
      deletedAt: null,
      status: 'ACTIVE',
      members: { some: { userId } },
    },
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...(filters.status && filters.status !== 'all' ? { status: filters.status.toUpperCase() } : {}),
    ...(filters.provider ? { targets: { some: { provider: filters.provider.toUpperCase() } } } : {}),
    ...(filters.search ? { content: { contains: filters.search, mode: 'insensitive' } } : {}),
  };
}

export async function createPublication(user, payload, request) {
  const targets = await Promise.all(payload.targets.map((target) => targetData(payload.brandId, target)));
  const publication = await prisma.publication.create({
    data: {
      brandId: payload.brandId,
      createdByUserId: user.id,
      content: payload.content,
      language: payload.language,
      hashtags: payload.hashtags,
      timezone: payload.timezone,
      targets: { create: targets },
    },
  });

  try {
    await attachMediaToPublication({ mediaIds: payload.mediaIds, publication, userId: user.id });
  } catch (error) {
    // Compensation : pas de publication orpheline si le média est refusé, et
    // les médias déjà déplacés redeviennent temporaires donc nettoyables.
    await detachMediaFromPublication(publication.id).catch(() => {});
    await prisma.publication.delete({ where: { id: publication.id } }).catch(() => {});
    throw error;
  }

  await writeAuditLog(prisma, {
    userId: user.id,
    action: 'publication.created',
    resourceType: 'publication',
    resourceId: publication.id,
    requestId: request.requestId,
    metadata: { brandId: payload.brandId, targets: payload.targets.map((target) => target.provider) },
  });

  return loadPublicPublication(publication.id);
}

export async function listPublications(userId, filters) {
  const where = accessibleWhere(userId, filters);
  if (filters.from || filters.to) {
    const range = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
    where.OR = [{ scheduledAt: range }, { publishedAt: range }];
  }

  const [total, records] = await prisma.$transaction([
    prisma.publication.count({ where }),
    prisma.publication.findMany({
      where,
      include: publicationInclude,
      orderBy: [{ createdAt: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);

  return {
    items: await toPublicPublications(records),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
  };
}

export async function countPublications(userId, filters) {
  const where = accessibleWhere(userId, filters);
  const grouped = await prisma.publication.groupBy({ by: ['status'], where, _count: { _all: true } });

  const counts = {
    all: 0,
    draft: 0,
    scheduled: 0,
    publishing: 0,
    published: 0,
    partially_published: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of grouped) {
    counts[row.status.toLowerCase()] = row._count._all;
    counts.all += row._count._all;
  }
  return counts;
}

/** Vue calendrier : tout ce qui est planifié ou publié dans la période. */
export async function calendar(userId, filters) {
  const where = accessibleWhere(userId, filters);
  where.OR = [
    { scheduledAt: { gte: filters.from, lte: filters.to } },
    { publishedAt: { gte: filters.from, lte: filters.to } },
  ];

  const records = await prisma.publication.findMany({
    where,
    include: publicationInclude,
    orderBy: [{ scheduledAt: 'asc' }, { publishedAt: 'asc' }],
    take: 500,
  });

  return { from: filters.from, to: filters.to, items: await toPublicPublications(records) };
}

export async function getPublication(publicationId) {
  return loadPublicPublication(publicationId);
}

export async function updatePublication(user, publication, payload, request) {
  if (!canEditContent(publication.status)) {
    throw new HttpError(409, 'conflict', 'Une publication en cours d’envoi ou publiée ne peut pas être modifiée.');
  }

  if (payload.targets) {
    const sentProviders = publication.targets
      .filter((target) => target.status === 'SENT')
      .map((target) => target.provider);
    const wanted = payload.targets.map((target) => target.provider.toUpperCase());
    if (sentProviders.some((provider) => !wanted.includes(provider))) {
      throw new HttpError(409, 'conflict', 'Un réseau déjà publié ne peut pas être retiré de la publication.');
    }

    await prisma.publicationTarget.deleteMany({
      where: { publicationId: publication.id, provider: { notIn: wanted }, status: { not: 'SENT' } },
    });
    for (const target of payload.targets) {
      const data = await targetData(publication.brandId, target);
      // No DB-level unique constraint on (publicationId, provider) anymore
      // (Sprint 06 moved it to (publicationId, socialAccountId) to allow two
      // accounts of the same provider) — upsert by hand instead of relying
      // on a compound key.
      const existing = await prisma.publicationTarget.findFirst({
        where: { publicationId: publication.id, provider: data.provider },
      });
      if (existing) {
        await prisma.publicationTarget.update({
          where: { id: existing.id },
          data: {
            socialAccountId: data.socialAccountId,
            adaptedContent: data.adaptedContent,
            adaptedHashtags: data.adaptedHashtags,
          },
        });
      } else {
        await prisma.publicationTarget.create({ data: { ...data, publicationId: publication.id } });
      }
    }
  }

  if (payload.mediaIds) {
    const current = publication.media.map((link) => link.mediaId);
    const unchanged =
      current.length === payload.mediaIds.length && current.every((id, index) => id === payload.mediaIds[index]);
    if (!unchanged) {
      await detachMediaFromPublication(publication.id);
      await attachMediaToPublication({ mediaIds: payload.mediaIds, publication, userId: user.id });
    }
  }

  await prisma.publication.update({
    where: { id: publication.id },
    data: {
      ...(payload.content !== undefined ? { content: payload.content } : {}),
      ...(payload.language !== undefined ? { language: payload.language } : {}),
      ...(payload.hashtags !== undefined ? { hashtags: payload.hashtags } : {}),
      ...(payload.timezone !== undefined ? { timezone: payload.timezone } : {}),
    },
  });

  await writeAuditLog(prisma, {
    userId: user.id,
    action: 'publication.updated',
    resourceType: 'publication',
    resourceId: publication.id,
    requestId: request.requestId,
    metadata: { fields: Object.keys(payload) },
  });

  return loadPublicPublication(publication.id);
}

export async function deletePublication(user, publication, request) {
  if (!canDelete(publication.status)) {
    throw new HttpError(409, 'conflict', 'Un envoi est en cours : attendez son issue avant de supprimer.');
  }

  if (publication.schedule?.jobId) {
    await cancelJob(QUEUES.publishScheduled, publication.schedule.jobId);
  }

  // Suppression logique : les envois déjà réalisés restent auditables.
  await prisma.$transaction([
    prisma.scheduledPublication.updateMany({
      where: { publicationId: publication.id, status: 'PENDING' },
      data: { status: 'CANCELLED', jobId: null },
    }),
    prisma.publication.update({
      where: { id: publication.id },
      data: { deletedAt: new Date(), scheduledAt: null },
    }),
  ]);

  await writeAuditLog(prisma, {
    userId: user.id,
    action: 'publication.deleted',
    resourceType: 'publication',
    resourceId: publication.id,
    requestId: request.requestId,
    metadata: { previousStatus: publication.status },
  });
}

export async function schedulePublication(user, publication, payload, request) {
  if (!canSchedule(publication.status)) {
    throw new HttpError(409, 'conflict', 'Cette publication ne peut plus être planifiée.');
  }
  if (publication.targets.length === 0) {
    throw new HttpError(422, 'unprocessable', 'Sélectionnez au moins un réseau avant de planifier.');
  }
  if (payload.scheduledAt.getTime() <= Date.now()) {
    throw new HttpError(422, 'unprocessable', 'La date et l’heure doivent être dans le futur.');
  }

  const timezone = payload.timezone ?? publication.timezone;

  // L’ancien job est annulé avant d’en créer un nouveau : une replanification
  // ne doit jamais laisser deux envois programmés.
  if (publication.schedule?.jobId) {
    await cancelJob(QUEUES.publishScheduled, publication.schedule.jobId);
  }

  const jobId = await enqueueScheduledPublish({
    publicationId: publication.id,
    requestedBy: user.id,
    scheduledAt: payload.scheduledAt.toISOString(),
  });

  await prisma.$transaction([
    prisma.scheduledPublication.upsert({
      where: { publicationId: publication.id },
      create: {
        publicationId: publication.id,
        scheduledAt: payload.scheduledAt,
        timezone,
        jobId,
        createdByUserId: user.id,
        status: 'PENDING',
      },
      update: { scheduledAt: payload.scheduledAt, timezone, jobId, status: 'PENDING' },
    }),
    prisma.publication.update({
      where: { id: publication.id },
      data: { status: 'SCHEDULED', scheduledAt: payload.scheduledAt, timezone },
    }),
  ]);

  await writeAuditLog(prisma, {
    userId: user.id,
    action: 'publication.scheduled',
    resourceType: 'publication',
    resourceId: publication.id,
    requestId: request.requestId,
    metadata: { scheduledAt: payload.scheduledAt.toISOString(), timezone, jobId },
  });

  return loadPublicPublication(publication.id);
}

export async function cancelSchedule(user, publication, request) {
  if (publication.status !== 'SCHEDULED') {
    throw new HttpError(409, 'conflict', 'Cette publication n’est pas planifiée.');
  }

  if (publication.schedule?.jobId) {
    await cancelJob(QUEUES.publishScheduled, publication.schedule.jobId);
  }

  await prisma.$transaction([
    prisma.scheduledPublication.updateMany({
      where: { publicationId: publication.id },
      data: { status: 'CANCELLED', jobId: null },
    }),
    // La publication redevient un brouillon : elle reste modifiable et
    // replanifiable, sans perdre son contenu.
    prisma.publication.update({
      where: { id: publication.id },
      data: { status: 'DRAFT', scheduledAt: null },
    }),
  ]);

  await writeAuditLog(prisma, {
    userId: user.id,
    action: 'publication.schedule_cancelled',
    resourceType: 'publication',
    resourceId: publication.id,
    requestId: request.requestId,
  });

  return loadPublicPublication(publication.id);
}

/** Transition conditionnelle : elle échoue si un autre acteur a déjà pris la main. */
async function claimForPublishing(publication) {
  const claimed = await prisma.publication.updateMany({
    where: {
      id: publication.id,
      deletedAt: null,
      status: { in: ['DRAFT', 'SCHEDULED', 'FAILED', 'PARTIALLY_PUBLISHED'] },
    },
    data: { status: 'PUBLISHING' },
  });

  if (claimed.count === 0) {
    throw new HttpError(409, 'conflict', 'Cette publication est déjà en cours d’envoi.');
  }
}

async function releaseClaim(publication) {
  await prisma.publication
    .updateMany({ where: { id: publication.id, status: 'PUBLISHING' }, data: { status: publication.status } })
    .catch(() => {});
}

export async function publishNow(user, publication, request) {
  if (!canPublish(publication.status)) {
    throw new HttpError(409, 'conflict', 'Cette publication ne peut pas être envoyée dans son état actuel.');
  }
  if (publication.targets.length === 0) {
    throw new HttpError(422, 'unprocessable', 'Sélectionnez au moins un réseau.');
  }
  if (publication.media.some((link) => link.media.status !== 'READY')) {
    throw new HttpError(422, 'media_not_ready', 'Le média n’est pas prêt. Réessayez dans un instant.');
  }

  // Une planification en attente est annulée : sinon le même contenu partirait
  // une seconde fois à l’heure prévue.
  if (publication.schedule?.jobId) {
    await cancelJob(QUEUES.publishScheduled, publication.schedule.jobId);
    await prisma.scheduledPublication.updateMany({
      where: { publicationId: publication.id, status: 'PENDING' },
      data: { status: 'DISPATCHED', jobId: null },
    });
  }

  await claimForPublishing(publication);

  let jobId;
  try {
    jobId = await enqueuePublishNow({
      publicationId: publication.id,
      requestedBy: user.id,
      idempotencyKey: request.get('idempotency-key') ?? null,
    });
  } catch (error) {
    await releaseClaim(publication);
    throw error;
  }

  await writeAuditLog(prisma, {
    userId: user.id,
    action: 'publication.publish_requested',
    resourceType: 'publication',
    resourceId: publication.id,
    requestId: request.requestId,
    metadata: { jobId },
  });

  return { jobId, publication: await loadPublicPublication(publication.id) };
}

export async function retryPublication(user, publication, payload, request) {
  if (publication.status !== 'FAILED' && publication.status !== 'PARTIALLY_PUBLISHED') {
    throw new HttpError(409, 'conflict', 'Seule une publication en échec peut être relancée.');
  }

  const providers = payload.provider ? [payload.provider.toUpperCase()] : undefined;
  const retryable = publication.targets.filter(
    (target) => target.status === 'FAILED' && (!providers || providers.includes(target.provider))
  );
  if (retryable.length === 0) {
    throw new HttpError(422, 'unprocessable', 'Aucun réseau en échec à relancer.');
  }

  await claimForPublishing(publication);

  let jobId;
  try {
    jobId = await enqueueRetry({
      publicationId: publication.id,
      requestedBy: user.id,
      providers: retryable.map((target) => target.provider),
      attempt: Math.max(...retryable.map((target) => target.attemptCount)) + 1,
    });
  } catch (error) {
    await releaseClaim(publication);
    throw error;
  }

  await writeAuditLog(prisma, {
    userId: user.id,
    action: 'publication.retry_requested',
    resourceType: 'publication',
    resourceId: publication.id,
    requestId: request.requestId,
    metadata: { providers: retryable.map((target) => target.provider), jobId },
  });

  return { jobId, publication: await loadPublicPublication(publication.id) };
}

export { computePublicationStatus };
