import { createHash } from 'node:crypto';

import { hasBrandRole } from '../brands/middleware.js';
import { prisma } from '../db/prisma.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';
import { callSocialService } from '../lib/socialServiceClient.js';

// Same one-way hash as graph-api's core/crypto.py::hash_state — the raw
// state itself is never persisted, on either side. Exported so the two
// implementations' agreement is covered by a cross-language test vector
// (test/social-accounts.test.js) instead of only being discovered in staging.
export function hashState(rawState) {
  return createHash('sha256').update(rawState, 'utf8').digest('hex');
}

export async function startConnect({ userId, brandId, provider, mobileRedirectUri }, request) {
  const result = await callSocialService(`/internal/v1/oauth/${provider}/authorization-url`, {
    scope: 'social:write',
    body: { userId, brandId, mobileRedirectUri },
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'social_account.connect_started',
    resourceType: 'brand',
    resourceId: brandId,
    requestId: request.requestId,
    metadata: { provider },
  });

  return {
    authorizationUrl: result.authorizationUrl,
    oauthState: result.state,
  };
}

// oauth_states isn't sensitive the way oauth_tokens is (no Meta secret in
// it), so Express reads it directly via Prisma instead of round-tripping
// through graph-api. Scope-boundary decision (Sprint 06 Day 2): this only
// reports whether the state was consumed, not the eventual success/failure
// of the account link — that outcome is carried by the deep-link redirect
// itself (app/oauth/callback.tsx's status/network/account/reason params),
// which is the primary channel. This endpoint is a fallback for when the
// in-app browser session was dismissed without a clean redirect capture.
export async function getOAuthStatus(userId, rawState) {
  const state = await prisma.oAuthState.findFirst({
    where: { stateHash: hashState(rawState), userId },
  });

  if (!state) {
    throw new HttpError(404, 'not_found', 'State OAuth introuvable.');
  }
  if (state.consumedAt) {
    return { status: 'COMPLETED' };
  }
  if (state.expiresAt < new Date()) {
    return { status: 'EXPIRED' };
  }
  return { status: 'PENDING' };
}

function toPublicAccount(account) {
  return {
    id: account.id,
    provider: account.provider.toLowerCase(),
    externalAccountId: account.externalAccountId,
    name: account.name,
    username: account.username,
    avatarUrl: account.avatarUrl,
    status: account.status.toLowerCase(),
    authMethod: account.authMethod,
    connectedAt: account.createdAt.toISOString(),
    lastCommentsSyncAt: account.lastCommentsSyncAt?.toISOString() ?? null,
    lastMetricsSyncAt: account.lastMetricsSyncAt?.toISOString() ?? null,
    permissions: account.permissions.map((permission) => ({
      permission: permission.permission,
      granted: permission.status === 'GRANTED',
    })),
  };
}

export async function listAccounts(brandId) {
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId },
    include: { permissions: true },
    orderBy: { createdAt: 'asc' },
  });
  return accounts.map(toPublicAccount);
}

// The account, not the URL, carries its brandId here (DELETE /:socialAccountId
// isn't nested under /brands/:brandId — matches the flat shape the sprint
// spec itself uses for /api/v1/social-accounts/*). Membership is therefore
// checked the same way requireBrandAccess does (see brands/middleware.js),
// just after resolving brandId from the account instead of from the path —
// a missing account and a real account in a brand the caller can't access
// both 404, so neither discloses which case it was.
async function requireAccountAccess(socialAccountId, userId, minimumRole = 'VIEWER') {
  const account = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    include: { permissions: true },
  });
  if (!account) {
    throw new HttpError(404, 'not_found', 'Compte social introuvable.');
  }

  const membership = await prisma.brandMember.findFirst({
    where: { brandId: account.brandId, userId },
  });
  if (!membership || !hasBrandRole(membership.role, minimumRole)) {
    throw new HttpError(404, 'not_found', 'Compte social introuvable.');
  }

  return account;
}

// "Sync" revalidates the connection against Meta (catches a silent
// revocation) rather than fetching comments/metrics — that persistence
// layer doesn't exist yet (Sprint 08/12, see docs/MATRICE_ENDPOINT_SPRINT.md).
// graph-api's REAUTHENTICATION_REQUIRED (409) is translated to this
// codebase's own token_expired by callSocialService, so the mobile's
// existing token_expired copy ("reconnect the account") actually fires
// instead of the generic conflict fallback.
export async function syncAccount({ userId, socialAccountId }, request) {
  const account = await requireAccountAccess(socialAccountId, userId);

  await callSocialService(`/internal/v1/social-accounts/${socialAccountId}/refresh-token`, {
    scope: 'social:write',
  });
  // refresh-token only revalidates the token/permissions; the displayed
  // name/username/avatar only ever refreshed at the initial OAuth connect
  // without this — a renamed Page or Instagram handle would otherwise stay
  // stale in Hootly forever.
  await callSocialService(`/internal/v1/social-accounts/${socialAccountId}/profile`, {
    method: 'GET',
    scope: 'social:read',
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'social_account.synced',
    resourceType: 'social_account',
    resourceId: socialAccountId,
    requestId: request.requestId,
    metadata: { provider: account.provider },
  });

  // refresh-token already updated status/permissions in place; re-read so
  // the response reflects them instead of the pre-sync snapshot.
  return toPublicAccount(await requireAccountAccess(socialAccountId, userId));
}

export async function disconnectAccount({ userId, socialAccountId }, request) {
  const account = await requireAccountAccess(socialAccountId, userId, 'ADMIN');

  await callSocialService(`/internal/v1/social-accounts/${socialAccountId}/revoke`, {
    scope: 'social:write',
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'social_account.disconnected',
    resourceType: 'social_account',
    resourceId: socialAccountId,
    requestId: request.requestId,
    metadata: { provider: account.provider },
  });
}
