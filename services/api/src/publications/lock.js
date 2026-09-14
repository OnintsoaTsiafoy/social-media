import { hasBrandRole } from '../brands/middleware.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';

export const approvalInclude = {
  requester: { select: { id: true, displayName: true } },
  reviewer: { select: { id: true, displayName: true } },
};

export const publicationContext = {
  targets: true,
  media: { include: { media: true } },
  schedule: true,
  approvals: { orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], take: 1, include: approvalInclude },
};

// All content, approval and dispatch mutations acquire the same row lock.
// Reload after locking: middleware data may predate a concurrent decision.
export async function withPublicationLock(user, publicationId, minimumRole, work) {
  return prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM publications WHERE id = ${publicationId}::uuid FOR UPDATE`;
    const publication = await db.publication.findFirst({
      where: { id: publicationId, deletedAt: null }, include: publicationContext,
    });
    if (!publication) throw new HttpError(404, 'not_found', 'Publication introuvable.');
    const membership = await db.brandMember.findFirst({
      where: { brandId: publication.brandId, userId: user.id, brand: { deletedAt: null, status: 'ACTIVE' } },
    });
    if (!membership) throw new HttpError(404, 'not_found', 'Publication introuvable.');
    if (!hasBrandRole(membership.role, minimumRole)) {
      throw new HttpError(403, 'forbidden', 'Vous n’avez pas les droits suffisants sur cette marque.');
    }
    return work(db, publication, membership);
  }, { timeout: 30000 });
}

export function toPublicApproval(record) {
  return {
    id: record.id, publicationId: record.publicationId,
    requestedBy: record.requestedBy, requesterName: record.requester?.displayName ?? '',
    reviewerId: record.reviewerId, reviewerName: record.reviewer?.displayName ?? null,
    status: record.status.toLowerCase(), revision: record.revision,
    comment: record.comment, requestComment: record.requestComment,
    requestedAt: record.requestedAt, reviewedAt: record.reviewedAt,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}
