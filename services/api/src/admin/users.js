import { prisma } from '../db/prisma.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';

const DAY_MS = 86_400_000;

// Du plus élevé au plus bas : le premier rôle rencontré est le « rôle principal ».
const ROLE_RANK = ['OWNER', 'ADMIN', 'COMMUNITY_MANAGER', 'VIEWER'];

const STATUS_FROM_WIRE = { active: 'ACTIVE', suspended: 'DISABLED' };
const STATUS_TO_WIRE = { ACTIVE: 'active', DISABLED: 'suspended' };

export function highestRole(memberships) {
  return ROLE_RANK.find((role) => memberships.some((membership) => membership.role === role)) ?? null;
}

const activeBrand = { deletedAt: null, status: 'ACTIVE' };

async function userMetrics(userIds, brandIds) {
  if (userIds.length === 0) return { lastSeen: new Map(), replies: new Map(), pages: new Map() };
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();

  const [sessions, replies, pages] = await Promise.all([
    prisma.userSession.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _max: { createdAt: true, lastUsedAt: true },
    }),
    prisma.$queryRaw`
      SELECT sr.sent_by_user_id AS user_id,
             COUNT(*)::int AS replies,
             AVG(EXTRACT(EPOCH FROM (sr.finished_at - COALESCE(c.meta_created_at, c.created_at)))::float8) AS average_seconds
      FROM sent_responses sr
      JOIN social_comments c ON c.id = sr.comment_id
      WHERE sr.status = 'SUCCEEDED' AND sr.finished_at >= ${since}::timestamptz
        AND sr.finished_at >= COALESCE(c.meta_created_at, c.created_at)
        AND sr.sent_by_user_id = ANY(${userIds}::uuid[])
      GROUP BY 1`,
    brandIds.length === 0
      ? []
      : prisma.socialAccount.groupBy({
          by: ['brandId'],
          where: { brandId: { in: brandIds }, status: { not: 'DISCONNECTED' } },
          _count: { _all: true },
        }),
  ]);

  const lastSeen = new Map(
    sessions.map((row) => {
      const dates = [row._max.createdAt, row._max.lastUsedAt].filter(Boolean);
      return [row.userId, new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString()];
    })
  );
  return {
    lastSeen,
    replies: new Map(replies.map((row) => [row.user_id, { count: row.replies, averageSeconds: row.average_seconds === null ? null : Math.round(Number(row.average_seconds)) }])),
    pages: new Map(pages.map((row) => [row.brandId, row._count._all])),
  };
}

function toAdminUser(user, metrics) {
  const memberships = user.memberships.map((membership) => ({
    brandId: membership.brandId,
    brandName: membership.brand.name,
    role: membership.role.toLowerCase(),
  }));
  const reachable = new Set(user.memberships.map((membership) => membership.brandId));
  const stats = metrics.replies.get(user.id);

  return {
    id: user.id,
    name: user.displayName,
    email: user.email,
    status: STATUS_TO_WIRE[user.status],
    platformRole: user.platformRole.toLowerCase(),
    role: highestRole(user.memberships)?.toLowerCase() ?? null,
    memberships,
    pagesCount: [...reachable].reduce((total, brandId) => total + (metrics.pages.get(brandId) ?? 0), 0),
    lastSeenAt: metrics.lastSeen.get(user.id) ?? null,
    createdAt: user.createdAt.toISOString(),
    replies30d: stats?.count ?? 0,
    averageResponseSeconds: stats?.averageSeconds ?? null,
  };
}

const userInclude = {
  memberships: { where: { brand: activeBrand }, include: { brand: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
};

async function presentUsers(users) {
  const brandIds = [...new Set(users.flatMap((user) => user.memberships.map((membership) => membership.brandId)))];
  const metrics = await userMetrics(users.map((user) => user.id), brandIds);
  return users.map((user) => toAdminUser(user, metrics));
}

export async function listUsers({ status, q, page, pageSize }) {
  const search = q
    ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] }
    : {};
  const where = { ...search, ...(status === 'all' ? {} : { status: STATUS_FROM_WIRE[status] }) };

  const [total, grouped, users] = await Promise.all([
    prisma.user.count({ where }),
    // Les pastilles du filtre comptent sur la recherche, pas sur le filtre de statut.
    prisma.user.groupBy({ by: ['status'], where: search, _count: { _all: true } }),
    prisma.user.findMany({
      where,
      include: userInclude,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const count = (value) => grouped.find((row) => row.status === value)?._count._all ?? 0;
  return {
    items: await presentUsers(users),
    page,
    pageSize,
    total,
    counts: { all: count('ACTIVE') + count('DISABLED'), active: count('ACTIVE'), suspended: count('DISABLED') },
  };
}

export async function getUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!user) throw new HttpError(404, 'not_found', 'Utilisateur introuvable.');
  return (await presentUsers([user]))[0];
}

/**
 * Modifie un compte : statut (suspension / réactivation), rôle plateforme et
 * rôles par marque, en une seule transaction et avec une ligne d'audit par
 * changement (les noms sont copiés dans les métadonnées : le journal reste
 * lisible même si la marque ou l'utilisateur est renommé plus tard).
 */
export async function updateUser(userId, patch, admin, request) {
  const target = await prisma.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!target) throw new HttpError(404, 'not_found', 'Utilisateur introuvable.');

  const self = target.id === admin.id;
  const nextStatus = patch.status ? STATUS_FROM_WIRE[patch.status] : null;
  const nextPlatformRole = patch.platformRole ? patch.platformRole.toUpperCase() : null;

  // Un administrateur ne peut pas se couper lui-même l'accès à la console.
  if (self && nextStatus === 'DISABLED') {
    throw new HttpError(409, 'conflict', 'Vous ne pouvez pas suspendre votre propre compte.');
  }
  if (self && nextPlatformRole === 'USER') {
    throw new HttpError(409, 'conflict', 'Vous ne pouvez pas retirer votre propre rôle d’administrateur.');
  }

  const membershipChanges = (patch.memberships ?? []).map((change) => {
    const membership = target.memberships.find((entry) => entry.brandId === change.brandId);
    if (!membership) throw new HttpError(404, 'not_found', 'Ce compte n’est pas membre de cette marque.');
    // Le propriétaire est porté par `brands.owner_user_id` : aucun transfert de propriété n'existe.
    if (membership.role === 'OWNER') {
      throw new HttpError(409, 'conflict', 'Le rôle du propriétaire d’une marque ne peut pas être modifié.');
    }
    return { membership, role: change.role.toUpperCase() };
  }).filter(({ membership, role }) => membership.role !== role);

  await prisma.$transaction(async (tx) => {
    const audit = (action, metadata) =>
      writeAuditLog(tx, { userId: admin.id, action, resourceType: 'user', resourceId: target.id, requestId: request.requestId, metadata: { userName: target.displayName, ...metadata } });

    if (nextStatus && nextStatus !== target.status) {
      await tx.user.update({ where: { id: target.id }, data: { status: nextStatus } });
      if (nextStatus === 'DISABLED') {
        // Comme la suppression de compte : plus aucune session ne survit à la suspension.
        await tx.userSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await audit(nextStatus === 'DISABLED' ? 'admin.user.suspended' : 'admin.user.reactivated', {});
    }

    if (nextPlatformRole && nextPlatformRole !== target.platformRole) {
      await tx.user.update({ where: { id: target.id }, data: { platformRole: nextPlatformRole } });
      await audit('admin.user.platform_role_changed', { from: target.platformRole.toLowerCase(), to: nextPlatformRole.toLowerCase() });
    }

    for (const { membership, role } of membershipChanges) {
      await tx.brandMember.update({ where: { id: membership.id }, data: { role } });
      await audit('admin.membership.role_changed', {
        brandId: membership.brandId,
        brandName: membership.brand.name,
        from: membership.role.toLowerCase(),
        to: role.toLowerCase(),
      });
    }
  });

  return getUser(target.id);
}
