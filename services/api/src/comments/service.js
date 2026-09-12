import { prisma } from '../db/prisma.js';
import { writeAuditLog } from '../lib/audit.js';
import { callSocialService } from '../lib/socialServiceClient.js';

// graph-api owns comment CONTENT (always sourced from Meta, via webhook or
// backfill sync — see graph-api/db/social_comments_repository.py). Express
// reads these tables directly via Prisma, same "not secret, unlike
// oauth_tokens" reasoning already applied to social_accounts, and only ever
// writes `status` for local moderation actions (ignore/escalate/manual-
// processed) — never content, author, or anything sourced from Meta.

export function authorInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// Batched, not per-comment: one extra query for the whole page/list instead
// of an N+1 join. Only ever resolves to a post Hootly itself published (see
// docs/SPRINT_08_WEBHOOKS_COMMENTAIRES_SYNCHRO.md's documented backfill
// limitation) — a comment on an organic post has no local Publication to
// point at, and falls back to the raw external id / a generic label.
async function resolvePublicationRefs(comments) {
  const pairs = comments
    .filter((comment) => comment.externalPublicationId)
    .map((comment) => ({ socialAccountId: comment.socialAccountId, externalPublicationId: comment.externalPublicationId }));
  if (pairs.length === 0) return new Map();

  const targets = await prisma.publicationTarget.findMany({
    where: { OR: pairs },
    select: { socialAccountId: true, externalPublicationId: true, publication: { select: { id: true, content: true } } },
  });

  const map = new Map();
  for (const target of targets) {
    map.set(`${target.socialAccountId}:${target.externalPublicationId}`, target.publication);
  }
  return map;
}

function toPublicComment(comment, publicationRefs) {
  const publication = comment.externalPublicationId
    ? publicationRefs.get(`${comment.socialAccountId}:${comment.externalPublicationId}`)
    : null;

  return {
    id: comment.id,
    network: comment.socialAccount.provider.toLowerCase(),
    authorName: comment.authorName ?? 'Auteur inconnu',
    authorInitials: authorInitials(comment.authorName),
    text: comment.content ?? '',
    publishedAt: (comment.metaCreatedAt ?? comment.createdAt).toISOString(),
    publicationId: publication?.id ?? comment.externalPublicationId ?? '',
    publicationTitle: publication?.content?.slice(0, 80) ?? `Publication ${comment.socialAccount.provider.toLowerCase()}`,
    status: comment.status.toLowerCase(),
    isNew: comment.status === 'NEW',
    deletedOnPlatform: comment.isDeletedOnPlatform,
    // Sprint 09/10 scope — no analysis/response pipeline exists yet.
    analysis: null,
    response: null,
  };
}

function accessibleWhere(brandId, filters) {
  return {
    socialAccount: {
      brandId,
      ...(filters.network ? { provider: filters.network.toUpperCase() } : {}),
    },
    ...(filters.status && filters.status !== 'all' ? { status: filters.status.toUpperCase() } : {}),
    ...(filters.publicationId ? { externalPublicationId: filters.publicationId } : {}),
    ...(filters.search ? { content: { contains: filters.search, mode: 'insensitive' } } : {}),
  };
}

export async function listComments(brandId, filters) {
  const where = accessibleWhere(brandId, filters);
  const [total, records] = await prisma.$transaction([
    prisma.socialComment.count({ where }),
    prisma.socialComment.findMany({
      where,
      include: { socialAccount: { select: { provider: true } } },
      orderBy: [{ createdAt: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);

  const publicationRefs = await resolvePublicationRefs(records);
  return {
    items: records.map((record) => toPublicComment(record, publicationRefs)),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
  };
}

// Sprint 09/10 fields (pendingAiResponses) always report 0 until that
// pipeline exists — never a fabricated non-zero count.
export async function commentsCounts(brandId) {
  const grouped = await prisma.socialComment.groupBy({
    by: ['status'],
    where: { socialAccount: { brandId } },
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));

  return {
    untreated: byStatus.NEW ?? 0,
    highPriority: 0,
    pendingAiResponses: 0,
  };
}

export async function getComment(comment) {
  const publicationRefs = await resolvePublicationRefs([comment]);
  return toPublicComment(comment, publicationRefs);
}

// Union of every source this sprint owns (comment_received, status_changed/
// escalated, send_failed/response_sent) — Sprint 09/10 kinds (ai_analysis,
// response_proposed, response_edited) simply never appear yet, by design,
// not as a placeholder to retrofit later (see the sprint doc).
export async function getCommentHistory(comment) {
  const [statusHistory, sentResponse] = await Promise.all([
    prisma.commentStatusHistory.findMany({
      where: { commentId: comment.id },
      include: { changedByUser: { select: { displayName: true } } },
      orderBy: { changedAt: 'asc' },
    }),
    prisma.sentResponse.findUnique({ where: { commentId: comment.id } }),
  ]);

  const events = [
    {
      id: `${comment.id}-received`,
      kind: 'comment_received',
      at: (comment.metaCreatedAt ?? comment.createdAt).toISOString(),
      title: 'Commentaire reçu',
    },
    ...statusHistory.map((entry) => ({
      id: entry.id,
      kind: entry.toStatus === 'ESCALATED' ? 'escalated' : 'status_changed',
      at: entry.changedAt.toISOString(),
      title: entry.toStatus === 'ESCALATED' ? 'Commentaire escaladé' : `Statut changé : ${entry.toStatus.toLowerCase()}`,
      detail: entry.note ?? undefined,
      actor: entry.changedByUser?.displayName,
    })),
  ];

  if (sentResponse) {
    events.push(
      sentResponse.status === 'SUCCEEDED'
        ? {
            id: sentResponse.id,
            kind: 'response_sent',
            at: (sentResponse.finishedAt ?? sentResponse.startedAt).toISOString(),
            title: 'Réponse envoyée',
            body: sentResponse.content,
          }
        : {
            id: sentResponse.id,
            kind: 'send_failed',
            at: (sentResponse.finishedAt ?? sentResponse.startedAt).toISOString(),
            title: 'Échec de l’envoi',
            detail: sentResponse.errorMessage ?? undefined,
          }
    );
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

// Local-only status transitions (ignore/escalate/manual-processed) — never
// calls graph-api or Meta. Mirrors graph-api's own social_comments_repository
// ::set_status (read old status, write new status + append history, one
// transaction) — same semantics, implemented separately per language, same
// as PublicationTarget.status already has two independent writers (Express
// claims PENDING→SENDING, the worker resolves SENDING→SENT/FAILED).
export async function setCommentStatus({ userId, comment, toStatus, note }, request) {
  const upper = toStatus.toUpperCase();
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.socialComment.update({
      where: { id: comment.id },
      data: { status: upper },
      include: { socialAccount: { select: { provider: true } } },
    });
    await tx.commentStatusHistory.create({
      data: { commentId: comment.id, fromStatus: comment.status, toStatus: upper, changedByUserId: userId, note },
    });
    return fresh;
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'comment.status_changed',
    resourceType: 'social_comment',
    resourceId: comment.id,
    requestId: request.requestId,
    metadata: { fromStatus: comment.status, toStatus: upper },
  });

  return getComment(updated);
}

// "Sync now" (mobile's pull-to-refresh on the inbox) — the real backfill
// already runs automatically every 15 minutes (services/worker/src/
// comment-sync.js), so this triggers the exact same graph-api call on
// demand for every connected account of the brand, rather than exposing a
// separate mechanism. Same limitation as the automatic backfill: only
// covers posts Hootly itself published (see the Sprint 08 doc) — an
// account with nothing published is silently skipped, not an error.
export async function syncBrandComments(brandId) {
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId, status: { in: ['CONNECTED', 'EXPIRING'] } },
  });

  let synced = 0;
  for (const account of accounts) {
    const targets = await prisma.publicationTarget.findMany({
      where: { socialAccountId: account.id, externalPublicationId: { not: null } },
      select: { externalPublicationId: true },
      distinct: ['externalPublicationId'],
    });
    if (targets.length === 0) continue;

    // A single failing account (most likely token_expired) stops the whole
    // action — the mobile screen's catch-all only shows one generic
    // "reconnect an account" message, it doesn't handle partial results.
    await callSocialService('/internal/v1/comments/sync', {
      scope: 'social:read',
      body: {
        socialAccountId: account.id,
        provider: account.provider.toLowerCase(),
        publicationExternalIds: targets.map((target) => target.externalPublicationId),
      },
    });
    synced += 1;
  }

  return { syncedAccounts: synced };
}

// A comment has at most one successful reply, ever — a deterministic,
// comment-scoped idempotency key is the semantically correct choice here,
// not a client-supplied one (unlike publications/routes.js's `withIdempotency`,
// built for actions with a genuine multi-attempt lifecycle like publish/retry).
// graph-api holds the REAL exactly-once guard (a claimed sent_responses row,
// reserved before it ever calls Meta) — this key only lets a legitimate
// Express-side retry (e.g. a dropped connection) replay the same response
// instead of asking graph-api to check its own claim table twice.
export async function replyToComment({ userId, comment, text }, request) {
  const result = await callSocialService('/internal/v1/comments/reply', {
    scope: 'social:write',
    idempotencyKey: `comment-reply:${comment.id}`,
    body: { commentId: comment.id, userId, text },
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'comment.reply_sent',
    resourceType: 'social_comment',
    resourceId: comment.id,
    requestId: request.requestId,
    metadata: { externalReplyId: result.externalReplyId },
  });

  // graph-api already moved the comment to PROCESSED as part of the same
  // call — re-read rather than assume, since that write happened directly
  // in Postgres, not through this process.
  const fresh = await prisma.socialComment.findUniqueOrThrow({
    where: { id: comment.id },
    include: { socialAccount: { select: { provider: true } } },
  });
  return getComment(fresh);
}
