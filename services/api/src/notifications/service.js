import { prisma } from '../db/prisma.js';
import { pushNotification } from './push.js';

// Mêmes types que le filtre "errors" de `notificationsApi.list()` côté
// mobile (social-media/src/data/api.ts) — à faire évoluer ensemble.
const ERROR_TYPES = ['PUBLICATION_FAILED', 'SYNC_FAILED', 'TOKEN_EXPIRED', 'TOKEN_EXPIRING', 'ACCOUNT_DISCONNECTED'];

// Route ouverte quand la notification ne porte pas de ressource précise
// (ex. "3 réponses IA à valider" ne pointe vers aucun commentaire en
// particulier) ou que la ressource visée n'est pas une page dédiée
// (compte social) mais un écran de réglages.
const GENERIC_HREF_BY_TYPE = {
  AI_RESPONSE_READY: '/comments',
  TOKEN_EXPIRING: '/settings/social-accounts',
  TOKEN_EXPIRED: '/settings/social-accounts',
  SYNC_FAILED: '/settings/social-accounts',
  ACCOUNT_DISCONNECTED: '/settings/social-accounts',
};

// Le push FCM ne transporte que `resourceType`/`resourceId` (voir le Jour 2
// du sprint) : c'est ici, à la lecture REST, que la route mobile est
// calculée — jamais côté client, qui n'a pas à connaître la table de routage.
function hrefFor(notification) {
  if (notification.resourceType === 'COMMENT' && notification.resourceId) {
    return `/comments/${notification.resourceId}`;
  }
  if (notification.resourceType === 'PUBLICATION' && notification.resourceId) {
    return `/publications/${notification.resourceId}`;
  }
  return GENERIC_HREF_BY_TYPE[notification.type] ?? '/notifications';
}

// Forme exactement alignée sur `AppNotification` côté mobile (déjà
// consommée par l'écran de notifications, aujourd'hui via des fixtures) :
// brancher `notificationsApi` sur l'API réelle ne doit demander aucun
// changement d'écran, seulement un changement de source de données.
export function toPublicNotification(notification) {
  return {
    id: notification.id,
    type: notification.type.toLowerCase(),
    title: notification.title,
    message: notification.message,
    priority: notification.priority.toLowerCase(),
    createdAt: notification.createdAt.toISOString(),
    read: notification.readAt !== null,
    network: notification.network ? notification.network.toLowerCase() : null,
    href: hrefFor(notification),
  };
}

function whereFor(userId, filter) {
  const where = { userId };
  if (filter === 'unread') where.readAt = null;
  if (filter === 'priority') where.priority = 'HIGH';
  if (filter === 'errors') where.type = { in: ERROR_TYPES };
  return where;
}

export async function listNotifications(userId, { filter, page, pageSize }) {
  const where = whereFor(userId, filter);
  const [total, records] = await prisma.$transaction([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    items: records.map(toPublicNotification),
    page,
    pageSize,
    total,
  };
}

export function unreadCount(userId) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

// Idempotent : relire une notification déjà lue ne doit ni échouer ni
// avancer `readAt`, sinon rouvrir l'écran écraserait silencieusement
// l'horodatage de la première lecture réelle.
export async function markRead(notification) {
  if (notification.readAt) return toPublicNotification(notification);
  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { readAt: new Date() },
  });
  return toPublicNotification(updated);
}

export async function markAllRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}

// `token` est unique globalement (voir DeviceToken dans schema.prisma) : un
// appareil réinstallé ou reconnecté sous un autre compte réassigne la même
// ligne au nouvel utilisateur plutôt que d'en laisser une orpheline
// pointer vers l'ancien. Efface aussi un éventuel `disabledAt` posé par un
// précédent échec FCM — un nouvel enregistrement vaut réhabilitation.
export async function registerDeviceToken(userId, { token, platform }) {
  const upper = platform.toUpperCase();
  const record = await prisma.deviceToken.upsert({
    where: { token },
    update: { userId, platform: upper, disabledAt: null, lastSeenAt: new Date() },
    create: { userId, token, platform: upper },
  });
  return {
    id: record.id,
    platform: record.platform.toLowerCase(),
    lastSeenAt: record.lastSeenAt.toISOString(),
  };
}

// Portée par `userId` ET `token` : un utilisateur ne peut jamais désassocier
// le token d'un autre, même en devinant sa valeur. Silencieux si le token
// n'existe déjà plus (déconnexion rejouée) — ce n'est pas une erreur.
export async function removeDeviceToken(userId, token) {
  await prisma.deviceToken.deleteMany({ where: { userId, token } });
}

const DEFAULT_SETTINGS = {
  negativeComment: true,
  urgentComment: true,
  highPriorityComment: true,
  aiResponseGenerated: true,
  publicationPublished: true,
  publicationFailed: true,
  tokenExpiring: true,
  syncFailed: true,
  sound: true,
  vibration: true,
  quietHoursStart: null,
  quietHoursEnd: null,
  minimumPriority: 'low',
};

// Mêmes valeurs par défaut que `DEFAULT_SETTINGS`, exposées même quand aucune
// ligne n'existe encore — même idiome que profile/service.js::preferencesOf.
function toPublicSettings(row) {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    negativeComment: row.negativeComment,
    urgentComment: row.urgentComment,
    highPriorityComment: row.highPriorityComment,
    aiResponseGenerated: row.aiResponseGenerated,
    publicationPublished: row.publicationPublished,
    publicationFailed: row.publicationFailed,
    tokenExpiring: row.tokenExpiring,
    syncFailed: row.syncFailed,
    sound: row.sound,
    vibration: row.vibration,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    minimumPriority: row.minimumPriority.toLowerCase(),
  };
}

export async function getNotificationSettings(userId) {
  const row = await prisma.notificationSetting.findUnique({ where: { userId } });
  return toPublicSettings(row);
}

// Crée la ligne au besoin (upsert) : un premier réglage n'a pas à être
// précédé d'une création implicite ailleurs (ex. à l'inscription).
export async function updateNotificationSettings(userId, patch) {
  const data = { ...patch };
  if (data.minimumPriority) data.minimumPriority = data.minimumPriority.toUpperCase();

  const row = await prisma.notificationSetting.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
  return toPublicSettings(row);
}

// Jour 3 — producteurs d'événements. Un seul point d'entrée, appelé à la
// fois en direct par Express (réponse générée, analyse à la demande) et par
// le worker via `POST /internal/v1/notifications` (Firebase Admin ne vivant
// que dans Express, voir push.js) : c'est ce qui garde une seule logique de
// persistance + vérification des préférences, plutôt que deux chemins qui
// pourraient diverger.

const SETTINGS_KEY_BY_TYPE = {
  PRIORITY_COMMENT: 'highPriorityComment',
  NEGATIVE_COMMENT: 'negativeComment',
  URGENT_COMMENT: 'urgentComment',
  AI_RESPONSE_READY: 'aiResponseGenerated',
  PUBLICATION_PUBLISHED: 'publicationPublished',
  PUBLICATION_FAILED: 'publicationFailed',
  // Une publication partiellement envoyée reste un échec partiel du point de
  // vue de l'utilisateur : même bascule que les échecs complets, pas une
  // troisième option que personne n'a demandé à régler séparément.
  PUBLICATION_PARTIAL: 'publicationFailed',
  TOKEN_EXPIRING: 'tokenExpiring',
  // Ni « expiré » ni « déconnecté » n'ont leur propre bascule côté mobile
  // (voir NotificationPreferences) : les deux sont des aggravations du même
  // problème que « expire bientôt », donc la même bascule les couvre.
  TOKEN_EXPIRED: 'tokenExpiring',
  ACCOUNT_DISCONNECTED: 'tokenExpiring',
  SYNC_FAILED: 'syncFailed',
};

const PRIORITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function currentLocalTime(date, timezone) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
      date
    );
  } catch {
    // Fuseau invalide ou absent : ne doit jamais bloquer un envoi, seulement
    // désactiver la vérification de plage silencieuse pour ce cas.
    return null;
  }
}

// `start`/`end` sont des "HH:mm" en heure locale de l'utilisateur (voir
// notification_settings.quiet_hours_start dans schema.prisma). Gère le
// chevauchement de minuit (ex. 22:00 -> 07:00) — la plage inverse (start
// après end) désigne alors la nuit, pas une plage vide.
export function isWithinQuietHours(nowHHMM, start, end) {
  if (!nowHHMM || !start || !end || start === end) return false;
  if (start < end) return nowHHMM >= start && nowHHMM < end;
  return nowHHMM >= start || nowHHMM < end;
}

async function shouldPush(userId, type, priority) {
  const settings = await prisma.notificationSetting.findUnique({ where: { userId } });
  const enabled = settings ? settings[SETTINGS_KEY_BY_TYPE[type]] : true;
  if (!enabled) return false;

  const floor = settings ? settings.minimumPriority : 'LOW';
  if (PRIORITY_RANK[priority] < PRIORITY_RANK[floor]) return false;

  // Priorité haute : toujours livrée, y compris en heures silencieuses —
  // une plage silencieuse est un confort, pas une raison de manquer un
  // signal urgent (voir Décisions d'architecture du sprint).
  if (settings?.quietHoursStart && settings?.quietHoursEnd && priority !== 'HIGH') {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } });
    const now = currentLocalTime(new Date(), user?.timezone ?? 'UTC');
    if (isWithinQuietHours(now, settings.quietHoursStart, settings.quietHoursEnd)) return false;
  }

  return true;
}

/** Persiste TOUJOURS la notification (avant tout envoi FCM, voir
 * l'ordre obligatoire du sprint) ; ne pousse qu'après un commit réussi ET si
 * les préférences de l'utilisateur l'autorisent. Idempotent par
 * (eventId, userId) : rejouer le même événement pour le même destinataire
 * (ex. un sweep worker relancé après un crash) ne crée jamais de doublon. */
export async function createNotification({
  userId,
  brandId,
  type,
  priority = 'MEDIUM',
  title,
  message,
  network,
  resourceType,
  resourceId,
  eventId,
}) {
  let notification;
  try {
    notification = await prisma.notification.create({
      data: { userId, brandId, type, priority, title, message, network, resourceType, resourceId, eventId },
    });
  } catch (error) {
    // Contrainte unique (eventId, userId) — voir schema.prisma. Un rejeu de
    // déduplication n'est pas une erreur, juste un aller-retour sans effet.
    if (error?.code === 'P2002') return { deduplicated: true };
    throw error;
  }

  if (await shouldPush(userId, type, priority)) {
    await pushNotification(notification);
  }
  return { deduplicated: false, notification: toPublicNotification(notification) };
}

// Résout les destinataires d'une notification de portée « marque » (analyse
// de commentaire, réponse générée) : tout membre VIEWER exclu, puisqu'un
// simple lecteur ne peut rien faire d'une alerte de modération. `excludeUserId`
// retire l'auteur de l'action déclenchante lui-même — inutile de le notifier
// de ce qu'il vient de faire, il l'a déjà sous les yeux (voir
// response-suggestions/service.js et comments/service.js::analyzeComment).
export async function notifiableBrandMembers(brandId, { excludeUserId } = {}) {
  const members = await prisma.brandMember.findMany({
    where: {
      brandId,
      role: { in: ['COMMUNITY_MANAGER', 'ADMIN', 'OWNER'] },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}
