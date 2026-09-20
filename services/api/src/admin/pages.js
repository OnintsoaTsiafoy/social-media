import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { providerOf } from './metrics.js';
import { autoReplyPageIds, setPageAutoReply } from './settings.js';

const DAY_MS = 86_400_000;
const TOKEN_WARNING_DAYS = 7;
const TEAM_ROLES = ['OWNER', 'ADMIN', 'COMMUNITY_MANAGER'];
const TEAM_PREVIEW = 3;

const ACTION_REQUIRED = ['EXPIRED', 'REAUTH_REQUIRED', 'REVOKED'];

/** CONNECTED → sain ; EXPIRING → à surveiller ; le reste exige une reconnexion. */
export function healthOf(status) {
  if (status === 'CONNECTED') return 'healthy';
  if (status === 'EXPIRING') return 'attention';
  return 'action_required';
}

/**
 * État du jeton d'un compte, d'après ses seules métadonnées (date d'expiration,
 * dernière erreur). Le jeton chiffré n'est jamais lu : la clé n'existe que côté
 * graph-api.
 */
export function tokenStateOf(account, token, now = new Date()) {
  const expiresAt = token?.expiresAt ?? null;
  const base = { expiresAt: expiresAt?.toISOString() ?? null, message: token?.lastErrorMessage ?? null };

  if (ACTION_REQUIRED.includes(account.status)) return { state: 'error', ...base };
  if (!expiresAt) return { state: 'unknown', ...base };
  if (expiresAt <= now) return { state: 'expired', ...base };
  if (expiresAt.getTime() - now.getTime() <= TOKEN_WARNING_DAYS * DAY_MS) return { state: 'expiring', ...base };
  return { state: 'valid', ...base };
}

const initialsOf = (user) => `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();

export async function listPages({ network, status }) {
  const provider = providerOf(network);
  const now = new Date();

  const accounts = await prisma.socialAccount.findMany({
    where: { status: { not: 'DISCONNECTED' }, ...(provider ? { provider } : {}) },
    include: {
      brand: {
        select: {
          id: true,
          name: true,
          members: {
            where: { role: { in: TEAM_ROLES }, user: { status: 'ACTIVE' } },
            select: { user: { select: { id: true, displayName: true, firstName: true, lastName: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
      // Métadonnées seulement : jamais les colonnes chiffrées.
      oauthTokens: {
        where: { status: 'ACTIVE' },
        orderBy: { version: 'desc' },
        take: 1,
        select: { expiresAt: true, lastErrorCode: true, lastErrorMessage: true },
      },
    },
    orderBy: [{ name: 'asc' }, { provider: 'asc' }],
  });

  const ids = accounts.map((account) => account.id);
  const [recent, untreated, autoReply] = await Promise.all([
    prisma.socialComment.groupBy({
      by: ['socialAccountId'],
      where: { socialAccountId: { in: ids }, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
      _count: { _all: true },
    }),
    prisma.socialComment.groupBy({
      by: ['socialAccountId'],
      where: { socialAccountId: { in: ids }, status: 'NEW' },
      _count: { _all: true },
    }),
    autoReplyPageIds(),
  ]);
  const countOf = (rows, id) => rows.find((row) => row.socialAccountId === id)?._count._all ?? 0;

  const items = accounts
    .map((account) => {
      const team = account.brand.members.map((member) => member.user);
      return {
        id: account.id,
        network: account.provider.toLowerCase(),
        name: account.name,
        handle: account.username ? `@${account.username.replace(/^@/, '')}` : null,
        followers: account.followersCount ?? null,
        status: healthOf(account.status),
        rawStatus: account.status.toLowerCase(),
        comments24h: countOf(recent, account.id),
        backlog: countOf(untreated, account.id),
        token: tokenStateOf(account, account.oauthTokens[0], now),
        brand: { id: account.brand.id, name: account.brand.name },
        team: team.slice(0, TEAM_PREVIEW).map((user) => ({ id: user.id, name: user.displayName, initials: initialsOf(user) })),
        teamCount: team.length,
        autoReply: autoReply.has(account.id),
        lastCommentsSyncAt: account.lastCommentsSyncAt?.toISOString() ?? null,
      };
    })
    .filter((item) => status === 'all' || item.status === status);

  return { items, totals: await pageCounts() };
}

async function pageCounts() {
  const rows = await prisma.socialAccount.groupBy({
    by: ['provider'],
    where: { status: { not: 'DISCONNECTED' } },
    _count: { _all: true },
  });
  const count = (provider) => rows.find((row) => row.provider === provider)?._count._all ?? 0;
  return { all: count('FACEBOOK') + count('INSTAGRAM'), facebook: count('FACEBOOK'), instagram: count('INSTAGRAM') };
}

export async function updatePage(pageId, { autoReply }, context) {
  const page = await prisma.socialAccount.findFirst({
    where: { id: pageId, status: { not: 'DISCONNECTED' } },
    select: { id: true, name: true, provider: true },
  });
  if (!page) throw new HttpError(404, 'not_found', 'Page introuvable.');
  return setPageAutoReply(page, autoReply, context);
}
