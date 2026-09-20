import { prisma } from '../db/prisma.js';
import { toPublicUser } from '../auth/service.js';
import { HttpError } from '../lib/http.js';
import { writeAuditLog } from '../lib/audit.js';

const defaultPreferences = {
  weeklyDigest: true,
  pushNotifications: true,
  weekStartsOn: 'monday',
};

function publicAvatar(media) {
  if (!media || media.status !== 'READY') return null;
  return {
    id: media.id,
    bucket: media.bucket,
    objectKey: media.objectKey,
    mimeType: media.mimeType,
    width: media.width,
    height: media.height,
  };
}

function preferencesOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...defaultPreferences, ...value }
    : { ...defaultPreferences };
}

function publicProfile(user) {
  return {
    ...toPublicUser(user),
    phone: user.phone,
    preferences: preferencesOf(user.preferences),
    avatar: publicAvatar(user.avatarMedia),
  };
}

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { avatarMedia: true } });
  if (!user) throw new HttpError(401, 'authentication_required', 'Session invalide.');
  return publicProfile(user);
}

export async function updateProfile(userId, payload, request) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: payload, include: { avatarMedia: true } });
    await writeAuditLog(tx, {
      userId,
      action: 'profile.updated',
      resourceType: 'user',
      resourceId: userId,
      requestId: request.requestId,
      metadata: { fields: Object.keys(payload) },
    });
    return publicProfile(user);
  });
}

export async function getPreferences(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  if (!user) throw new HttpError(401, 'authentication_required', 'Session invalide.');
  return preferencesOf(user.preferences);
}

export async function updatePreferences(userId, payload, request) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } });
    const preferences = { ...preferencesOf(current.preferences), ...payload };
    await tx.user.update({ where: { id: userId }, data: { preferences } });
    await writeAuditLog(tx, {
      userId,
      action: 'profile.preferences_updated',
      resourceType: 'user_preferences',
      resourceId: userId,
      requestId: request.requestId,
      metadata: { fields: Object.keys(payload) },
    });
    return preferences;
  });
}

export async function saveAvatar(userId, payload, request) {
  if (!payload.objectKey.startsWith(`avatars/${userId}/`)) {
    throw new HttpError(400, 'validation_failed', 'La clé de l’avatar doit appartenir à l’utilisateur connecté.');
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarMediaId: true } });
    const media = await tx.media.create({ data: { ownerUserId: userId, ...payload } });
    await tx.user.update({ where: { id: userId }, data: { avatarMediaId: media.id } });
    if (current.avatarMediaId) {
      await tx.media.updateMany({ where: { id: current.avatarMediaId, ownerUserId: userId }, data: { status: 'DELETED' } });
    }
    await writeAuditLog(tx, {
      userId,
      action: 'profile.avatar_updated',
      resourceType: 'media',
      resourceId: media.id,
      requestId: request.requestId,
    });
    return publicAvatar(media);
  });
}

export async function deleteAvatar(userId, request) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarMediaId: true } });
    await tx.user.update({ where: { id: userId }, data: { avatarMediaId: null } });
    if (current.avatarMediaId) {
      await tx.media.updateMany({ where: { id: current.avatarMediaId, ownerUserId: userId }, data: { status: 'DELETED' } });
    }
    await writeAuditLog(tx, {
      userId,
      action: 'profile.avatar_deleted',
      resourceType: 'media',
      resourceId: current.avatarMediaId,
      requestId: request.requestId,
    });
  });
}
