import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { writeAuditLog } from '../lib/audit.js';
import { pushPersistedNotification } from '../notifications/service.js';
import { approvalInclude, toPublicApproval, withPublicationLock } from '../publications/lock.js';
import { getPublication, publicationInclude, toPublicPublications } from '../publications/service.js';

const REVIEW_ROLES = ['ADMIN', 'OWNER'];
const decisions = {
  approve: { status: 'APPROVED', publicationStatus: 'APPROVED', type: 'PUBLICATION_APPROVED', title: 'Publication approuvée' },
  reject: { status: 'REJECTED', publicationStatus: 'REJECTED', type: 'PUBLICATION_REJECTED', title: 'Publication refusée' },
  'request-changes': { status: 'CHANGES_REQUESTED', publicationStatus: 'REJECTED', type: 'PUBLICATION_CHANGES_REQUESTED', title: 'Modifications demandées' },
  'cancel-approval': { status: 'CANCELLED', publicationStatus: 'DRAFT' },
};

export async function approvalMembers(brandId) {
  const members = await prisma.brandMember.findMany({
    where: { brandId, user: { status: 'ACTIVE' } },
    select: { role: true, user: { select: { id: true, displayName: true } } },
    orderBy: { user: { displayName: 'asc' } },
  });
  return members.map(({ role, user }) => ({ ...user, role: role.toLowerCase() }));
}

export async function changeApproval(user, publication, action, payload, request) {
  const minimumRole = ['approve', 'reject', 'request-changes'].includes(action) ? 'ADMIN' : 'COMMUNITY_MANAGER';
  const notifications = await withPublicationLock(user, publication.id, minimumRole, async (db, current, membership) => {
    const fromStatus = current.status;
    let approval, toStatus, notification, recipientIds;
    if (action === 'request-approval') {
      if (current.status !== 'DRAFT') throw new HttpError(409, 'conflict', 'Seul un brouillon peut être soumis.');
      if (!current.targets.length) throw new HttpError(422, 'unprocessable', 'Sélectionnez au moins un réseau.');
      if (current.media.some((link) => link.media.status !== 'READY')) {
        throw new HttpError(422, 'media_not_ready', 'Un média n’est pas prêt.');
      }
      const reviewers = await db.brandMember.findMany({
        where: { brandId: current.brandId, role: { in: REVIEW_ROLES }, user: { status: 'ACTIVE' },
          ...(payload.reviewerId ? { userId: payload.reviewerId } : {}) },
        select: { userId: true },
      });
      if (!reviewers.length) throw new HttpError(422, 'unprocessable', 'Choisissez un administrateur ou propriétaire de cette marque.');
      approval = await db.publicationApproval.create({ data: {
        publicationId: current.id, requestedBy: user.id, reviewerId: payload.reviewerId ?? null,
        revision: current.contentRevision, requestComment: payload.comment || null,
      } });
      toStatus = 'PENDING_APPROVAL';
      notification = { type: 'PUBLICATION_APPROVAL_REQUESTED', title: 'Nouvelle publication à valider' };
      recipientIds = reviewers.map((member) => member.userId);
    } else {
      const decision = decisions[action];
      approval = current.approvals[0];
      if (!decision || current.status !== 'PENDING_APPROVAL' || approval?.status !== 'PENDING' ||
          approval.id !== payload.approvalId || approval.revision !== current.contentRevision) {
        throw new HttpError(409, 'conflict', 'Cette demande n’est plus en attente. Actualisez la publication.');
      }
      if (action === 'cancel-approval' && !REVIEW_ROLES.includes(membership.role) &&
          approval.requestedBy !== user.id && current.createdByUserId !== user.id) {
        throw new HttpError(403, 'forbidden', 'Seul l’auteur, le demandeur ou un responsable peut annuler la demande.');
      }
      // Any brand administrator may take over a request; reviewerId records
      // the actual decision maker, while the request audit retains assignment.
      approval = await db.publicationApproval.update({ where: { id: approval.id }, data: {
        status: decision.status, comment: payload.comment || null, reviewedAt: new Date(),
        ...(action !== 'cancel-approval' ? { reviewerId: user.id } : {}),
      } });
      toStatus = decision.publicationStatus;
      notification = decision.type ? decision : null;
      recipientIds = [current.createdByUserId];
    }
    await db.publication.update({ where: { id: current.id }, data: {
      status: toStatus, approvedRevision: toStatus === 'APPROVED' ? current.contentRevision : null,
    } });
    await writeAuditLog(db, {
      userId: user.id, action: `publication.${action.replaceAll('-', '_')}`,
      resourceType: 'publication', resourceId: current.id, requestId: request.requestId,
      metadata: { approvalId: approval.id, fromStatus, toStatus, comment: payload.comment || null,
        reviewerId: approval.reviewerId, revision: current.contentRevision },
    });
    if (!notification) return [];
    // Persist together with the decision, then push only after commit.
    const records = [];
    for (const userId of new Set(recipientIds)) {
      records.push(await db.notification.create({ data: {
        userId, brandId: current.brandId, type: notification.type, priority: 'MEDIUM',
        title: notification.title, message: payload.comment || notification.title,
        resourceType: 'PUBLICATION', resourceId: current.id,
        eventId: `approval:${approval.id}:${notification.type}`,
      } }));
    }
    return records;
  });
  for (const notification of notifications) {
    await pushPersistedNotification(notification).catch((error) =>
      console.warn({ scope: 'approval-push', notificationId: notification.id, error: error?.message }));
  }
  return getPublication(publication.id);
}

export async function listApprovals(userId, filters) {
  const where = {
    ...(filters.status !== 'all' ? { status: filters.status.toUpperCase() } : {}),
    ...(filters.reviewerId ? { reviewerId: filters.reviewerId } : {}),
    publication: { deletedAt: null,
      ...(filters.authorId ? { createdByUserId: filters.authorId } : {}),
      ...(filters.brandId ? { brandId: filters.brandId } : {}),
      brand: { deletedAt: null, status: 'ACTIVE', members: { some: { userId, role: { in: REVIEW_ROLES } } } },
    },
  };
  const [total, rows] = await prisma.$transaction([
    prisma.publicationApproval.count({ where }),
    prisma.publicationApproval.findMany({ where, include: { ...approvalInclude, publication: { include: publicationInclude } },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }),
  ]);
  const publications = await toPublicPublications(rows.map((row) => row.publication));
  return { total, page: filters.page, pageSize: filters.pageSize,
    items: rows.map((row, index) => ({ ...toPublicApproval(row), publication: publications[index] })) };
}

export async function approvalHistory(publicationId, { page, pageSize }) {
  const where = { resourceType: 'publication', resourceId: publicationId, action: { startsWith: 'publication.' } };
  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, include: { user: { select: { displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { total, page, pageSize, items: rows.map((row) => ({
    id: row.id, action: row.action, actorId: row.userId, actorName: row.user?.displayName ?? 'Système',
    timestamp: row.createdAt, comment: row.metadata?.comment ?? null,
    fromStatus: row.metadata?.fromStatus?.toLowerCase() ?? null,
    toStatus: row.metadata?.toStatus?.toLowerCase() ?? null,
    reviewerId: row.metadata?.reviewerId ?? null, approvalId: row.metadata?.approvalId ?? null,
  })) };
}
