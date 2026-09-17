import { randomBytes, randomUUID } from 'node:crypto';

import bcrypt from 'bcrypt';

import { prisma } from '../db/prisma.js';
import { activeBrandForUser, deleteBrand } from '../brands/service.js';
import { HttpError } from '../lib/http.js';
import { unreadCount } from '../notifications/service.js';
import { cancelSchedule } from '../publications/service.js';
import { disconnectAccount } from '../social-accounts/service.js';
import { accessTokenTtlSeconds, createAccessToken, refreshTokenTtlSeconds } from './tokens.js';

const BCRYPT_ROUNDS = 12;

export function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    language: user.language,
    timezone: user.timezone,
    phone: user.phone,
    createdAt: user.createdAt,
    avatarInitials: `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase(),
  };
}

function opaqueToken(sessionId) {
  return `${sessionId}.${randomBytes(48).toString('base64url')}`;
}

function parseOpaqueToken(token) {
  const separator = token.indexOf('.');
  if (separator < 1 || separator === token.length - 1 || token.indexOf('.', separator + 1) !== -1) {
    throw new HttpError(401, 'authentication_required', 'Session invalide.');
  }
  return { sessionId: token.slice(0, separator), rawToken: token };
}

function metadataFromRequest(request) {
  return {
    deviceName: request.get('x-device-name')?.slice(0, 255) || request.get('user-agent')?.slice(0, 255) || 'Unknown device',
    requestId: request.requestId,
  };
}

async function writeAudit(tx, { userId, action, resourceType, resourceId, requestId, metadata }) {
  await tx.auditLog.create({
    data: { userId, action, resourceType, resourceId, requestId, metadata },
  });
}

async function issueSession(tx, user, request) {
  const id = randomUUID();
  const refreshToken = opaqueToken(id);
  const refreshTokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + refreshTokenTtlSeconds() * 1000);
  const { deviceName } = metadataFromRequest(request);

  await tx.userSession.create({
    data: { id, userId: user.id, refreshTokenHash, deviceName, expiresAt },
  });

  return {
    accessToken: createAccessToken(user.id, id),
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: accessTokenTtlSeconds(),
    sessionId: id,
  };
}

function sessionResponse(session, user) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenType: session.tokenType,
    expiresIn: session.expiresIn,
    user: toPublicUser(user),
  };
}

export async function register(payload, request) {
  const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: payload.email,
          passwordHash,
          firstName: payload.firstName,
          lastName: payload.lastName,
          displayName: payload.displayName || `${payload.firstName} ${payload.lastName}`,
          language: payload.language,
          timezone: payload.timezone,
        },
      });
      const session = await issueSession(tx, user, request);
      await writeAudit(tx, {
        userId: user.id,
        action: 'auth.registered',
        resourceType: 'user',
        resourceId: user.id,
        requestId: request.requestId,
      });
      return sessionResponse(session, user);
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      throw new HttpError(409, 'email_taken', 'Cette adresse email est déjà utilisée.');
    }
    throw error;
  }
}

export async function login(payload, request) {
  const user = await prisma.user.findUnique({ where: { email: payload.email } });
  const validPassword = user ? await bcrypt.compare(payload.password, user.passwordHash) : false;

  if (!user || !validPassword) {
    throw new HttpError(401, 'invalid_credentials', 'Adresse email ou mot de passe incorrect.');
  }
  if (user.status !== 'ACTIVE') {
    throw new HttpError(403, 'account_disabled', 'Ce compte a été désactivé.');
  }

  return prisma.$transaction(async (tx) => {
    const session = await issueSession(tx, user, request);
    await writeAudit(tx, {
      userId: user.id,
      action: 'auth.logged_in',
      resourceType: 'user_session',
      resourceId: session.sessionId,
      requestId: request.requestId,
    });
    return sessionResponse(session, user);
  });
}

export async function refresh(refreshToken, request) {
  const { sessionId, rawToken } = parseOpaqueToken(refreshToken);
  const current = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });

  if (!current || !current.user || current.user.status !== 'ACTIVE') {
    throw new HttpError(401, 'authentication_required', 'Session invalide.');
  }

  const now = new Date();
  if (current.revokedAt || current.expiresAt <= now || !(await bcrypt.compare(rawToken, current.refreshTokenHash))) {
    await prisma.$transaction(async (tx) => {
      await tx.userSession.updateMany({
        where: { userId: current.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await writeAudit(tx, {
        userId: current.userId,
        action: 'auth.refresh_reuse_detected',
        resourceType: 'user_session',
        resourceId: current.id,
        requestId: request.requestId,
      });
    });
    throw new HttpError(401, 'authentication_required', 'Session invalide.');
  }

  const rotated = await prisma.$transaction(async (tx) => {
    // Réclamation conditionnelle : deux rafraîchissements concurrents du même
    // jeton passent tous deux la vérification ci-dessus, un seul peut révoquer.
    const claim = await tx.userSession.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: now, lastUsedAt: now },
    });
    if (claim.count === 0) return null;

    const replacement = await issueSession(tx, current.user, request);
    await tx.userSession.update({
      where: { id: current.id },
      data: { replacedBySessionId: replacement.sessionId },
    });
    await writeAudit(tx, {
      userId: current.userId,
      action: 'auth.refreshed',
      resourceType: 'user_session',
      resourceId: replacement.sessionId,
      requestId: request.requestId,
    });
    return sessionResponse(replacement, current.user);
  });

  if (!rotated) throw new HttpError(401, 'authentication_required', 'Session invalide.');
  return rotated;
}

export async function logout(auth, request) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.userSession.updateMany({
      where: { id: auth.sessionId, userId: auth.user.id, revokedAt: null },
      data: { revokedAt: now },
    });
    await writeAudit(tx, {
      userId: auth.user.id,
      action: 'auth.logged_out',
      resourceType: 'user_session',
      resourceId: auth.sessionId,
      requestId: request.requestId,
    });
  });
}

// Sprint 11 Jour 5 : c'est par ce chemin (l'écran de démarrage, voir
// SessionProvider::restore côté mobile) que l'app rattrape le compteur non
// lu après une absence — jamais par le push seul, qui peut avoir été
// manqué (app fermée sans FCM, appareil hors ligne). `unreadCount` était un
// placeholder à 0 avant que la table `notifications` n'existe.
export async function currentUser(auth) {
  return {
    user: toPublicUser(auth.user),
    brand: await activeBrandForUser(auth.user.id),
    unreadCount: await unreadCount(auth.user.id),
  };
}

export async function requestPasswordReset(email, request) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') return;

  const id = randomUUID();
  const token = opaqueToken(id);
  const tokenHash = await bcrypt.hash(token, BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.create({ data: { id, userId: user.id, tokenHash, expiresAt } });
    await writeAudit(tx, {
      userId: user.id,
      action: 'auth.password_reset_requested',
      resourceType: 'password_reset_token',
      resourceId: id,
      requestId: request.requestId,
    });
  });

  // The token is deliberately neither returned nor logged. Wiring an email
  // provider requires credentials and sender-domain approval outside this sprint.
}

export async function resetPassword(token, password, request) {
  const { sessionId: id, rawToken } = parseOpaqueToken(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { id }, include: { user: true } });
  const now = new Date();
  if (!record || record.usedAt || record.expiresAt <= now || !(await bcrypt.compare(rawToken, record.tokenHash))) {
    throw new HttpError(401, 'token_expired', 'Ce lien de réinitialisation est expiré ou déjà utilisé.');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } });
    await tx.userSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: now } });
    await writeAudit(tx, {
      userId: record.userId,
      action: 'auth.password_reset_completed',
      resourceType: 'user',
      resourceId: record.userId,
      requestId: request.requestId,
    });
  });
}

export async function changePassword(auth, currentPassword, newPassword, request) {
  if (!(await bcrypt.compare(currentPassword, auth.user.passwordHash))) {
    throw new HttpError(401, 'invalid_credentials', 'Le mot de passe actuel est incorrect.');
  }
  if (currentPassword === newPassword) {
    throw new HttpError(400, 'validation_failed', 'Le nouveau mot de passe doit être différent de l’ancien.');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: auth.user.id }, data: { passwordHash } });
    await tx.userSession.updateMany({ where: { userId: auth.user.id, revokedAt: null }, data: { revokedAt: now } });
    const replacement = await issueSession(tx, auth.user, request);
    await writeAudit(tx, {
      userId: auth.user.id,
      action: 'auth.password_changed',
      resourceType: 'user',
      resourceId: auth.user.id,
      requestId: request.requestId,
    });
    return sessionResponse(replacement, auth.user);
  });
}

export async function listSessions(auth) {
  const sessions = await prisma.userSession.findMany({
    where: { userId: auth.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return sessions.map((session) => ({
    id: session.id,
    device: session.deviceName,
    // Un appareil qui vient de se connecter n'a pas encore rafraîchi son
    // jeton : lastUsedAt reste `null` jusque-là (voir refresh() plus haut).
    lastActiveAt: (session.lastUsedAt ?? session.createdAt).toISOString(),
    current: session.id === auth.sessionId,
  }));
}

export async function revokeSession(auth, sessionId, request) {
  const session = await prisma.userSession.findFirst({
    where: { id: sessionId, userId: auth.user.id, revokedAt: null },
  });
  if (!session) {
    throw new HttpError(404, 'not_found', 'Session introuvable.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await writeAudit(tx, {
      userId: auth.user.id,
      action: 'auth.session_revoked',
      resourceType: 'user_session',
      resourceId: sessionId,
      requestId: request.requestId,
    });
  });
}

export async function revokeAllSessions(auth, request) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.userSession.updateMany({ where: { userId: auth.user.id, revokedAt: null }, data: { revokedAt: now } });
    await writeAudit(tx, {
      userId: auth.user.id,
      action: 'auth.all_sessions_revoked',
      resourceType: 'user_session',
      resourceId: auth.sessionId,
      requestId: request.requestId,
    });
  });
}

/**
 * Suppression de compte (Sprint 13). `Brand.ownerUserId` est obligatoire et
 * il n'existe aucun transfert de propriété : si une marque possédée a
 * encore d'autres membres actifs, la suppression est refusée plutôt que de
 * les priver silencieusement de leur accès (décision produit du Sprint 13,
 * voir docs/SPRINT_13). L'utilisateur doit d'abord retirer ou transférer
 * ces membres. Une marque possédée sans autre membre est en revanche
 * archivée comme le permet déjà `deleteBrand`, après annulation de ses
 * publications planifiées et déconnexion de ses comptes sociaux — les deux
 * promesses de l'écran mobile de suppression.
 */
export async function deleteAccount(auth, password, request) {
  if (!(await bcrypt.compare(password, auth.user.passwordHash))) {
    throw new HttpError(401, 'invalid_credentials', 'Le mot de passe est incorrect.');
  }

  const ownedMemberships = await prisma.brandMember.findMany({
    where: {
      userId: auth.user.id,
      role: 'OWNER',
      isActive: true,
      brand: { deletedAt: null, status: 'ACTIVE' },
    },
    include: { brand: true },
  });

  for (const membership of ownedMemberships) {
    const otherActiveMembers = await prisma.brandMember.count({
      where: { brandId: membership.brandId, userId: { not: auth.user.id }, isActive: true },
    });
    if (otherActiveMembers > 0) {
      throw new HttpError(
        409,
        'conflict',
        `Transférez ou retirez les autres membres de « ${membership.brand.name} » avant de supprimer votre compte.`
      );
    }
  }

  for (const membership of ownedMemberships) {
    const scheduledPublications = await prisma.publication.findMany({
      where: { brandId: membership.brandId, status: 'SCHEDULED', deletedAt: null },
      include: { schedule: true },
    });
    for (const publication of scheduledPublications) {
      await cancelSchedule(auth.user, publication, request);
    }

    const socialAccounts = await prisma.socialAccount.findMany({ where: { brandId: membership.brandId } });
    for (const account of socialAccounts) {
      await disconnectAccount({ userId: auth.user.id, socialAccountId: account.id }, request);
    }

    await deleteBrand(membership.brandId, membership, request);
  }

  // Marques dont l'utilisateur n'est qu'un membre : il ne fait que les
  // quitter, la marque et ses autres membres ne sont pas affectés.
  await prisma.brandMember.updateMany({
    where: { userId: auth.user.id, role: { not: 'OWNER' }, isActive: true },
    data: { isActive: false },
  });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.userSession.updateMany({ where: { userId: auth.user.id, revokedAt: null }, data: { revokedAt: now } });
    await tx.user.update({ where: { id: auth.user.id }, data: { status: 'DISABLED' } });
    await writeAudit(tx, {
      userId: auth.user.id,
      action: 'auth.account_deleted',
      resourceType: 'user',
      resourceId: auth.user.id,
      requestId: request.requestId,
    });
  });
}
