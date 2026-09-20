import { prisma } from '../db/prisma.js';

// Le journal d'audit mélange tout ce que fait la plateforme (connexions,
// publications, réponses…). La console n'affiche que ce qui concerne
// l'administration : les actions `admin.*` plus quelques événements de compte
// et de page. Les autres restent en base, consultables autrement.

const KIND_BY_ACTION = {
  'admin.membership.role_changed': 'role',
  'admin.user.platform_role_changed': 'role',
  'admin.user.suspended': 'user',
  'admin.user.reactivated': 'user',
  'auth.account_deleted': 'user',
  'admin.settings.supervision_updated': 'ai',
  'admin.page.auto_reply_changed': 'page',
  'social_account.disconnected': 'page',
  'admin.settings.keyword_added': 'rule',
  'admin.settings.keyword_removed': 'rule',
  'admin.settings.service_levels_updated': 'rule',
};

const VISIBLE_ACTIONS = Object.keys(KIND_BY_ACTION);

/** Famille d'un événement (ROLE, AI, PAGE, USER, RULE côté console) ; `null` = hors périmètre. */
export function auditKindOf(action) {
  return KIND_BY_ACTION[action] ?? null;
}

// Seules ces clés des métadonnées sortent de l'API : le reste n'a pas été écrit
// pour être affiché.
const PUBLIC_METADATA = ['userName', 'brandName', 'pageName', 'provider', 'keyword', 'from', 'to', 'enabled', 'before', 'after'];

export function publicMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  return Object.fromEntries(PUBLIC_METADATA.filter((key) => key in metadata).map((key) => [key, metadata[key]]));
}

export async function listAuditTrail({ page, pageSize }) {
  const where = { action: { in: VISIBLE_ACTIONS } };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      action: row.action,
      kind: auditKindOf(row.action),
      actor: row.user ? { id: row.user.id, name: row.user.displayName } : null,
      metadata: publicMetadata(row.metadata),
    })),
    page,
    pageSize,
    total,
  };
}
