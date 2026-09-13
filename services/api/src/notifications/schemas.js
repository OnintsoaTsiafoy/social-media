import { z } from 'zod';

// Vocabulaire du mobile depuis le Sprint 01 (social-media/src/types/index.ts
// ::NotificationType) : minuscules sur le fil, majuscules en base (voir
// NotificationType dans schema.prisma), un seul vocabulaire des deux côtés —
// aucune table de correspondance n'est nécessaire, `.toLowerCase()` suffit.
const TYPES = [
  'priority_comment',
  'negative_comment',
  'urgent_comment',
  'ai_response_ready',
  'publication_published',
  'publication_failed',
  'publication_partial',
  'token_expiring',
  'token_expired',
  'sync_failed',
  'account_disconnected',
];
const PRIORITIES = ['low', 'medium', 'high'];
const PLATFORMS = ['android', 'ios'];
const QUIET_HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

export const notificationIdSchema = z.uuid();

// Mêmes quatre filtres que `notificationsApi.list()` côté mobile (encore en
// fixtures aujourd'hui) : le jour où cette façade sera rebranchée sur l'API
// réelle, la sémantique de chaque filtre ne doit pas changer.
export const listNotificationsQuerySchema = z.object({
  filter: z.enum(['all', 'unread', 'priority', 'errors']).default('all'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const registerDeviceTokenSchema = z.object({
  token: z.string().trim().min(1).max(400),
  platform: z.enum(PLATFORMS),
});

// Le token voyage dans le corps, pas dans l'URL : c'est ce que liste le
// sprint (`DELETE /api/v1/device-tokens`, sans segment d'id).
export const removeDeviceTokenSchema = z.object({
  token: z.string().trim().min(1).max(400),
});

export const updateNotificationSettingsSchema = z
  .object({
    negativeComment: z.boolean().optional(),
    urgentComment: z.boolean().optional(),
    highPriorityComment: z.boolean().optional(),
    aiResponseGenerated: z.boolean().optional(),
    publicationPublished: z.boolean().optional(),
    publicationFailed: z.boolean().optional(),
    tokenExpiring: z.boolean().optional(),
    syncFailed: z.boolean().optional(),
    sound: z.boolean().optional(),
    vibration: z.boolean().optional(),
    quietHoursStart: z.union([z.string().regex(QUIET_HOUR, 'Format attendu : HH:mm.'), z.null()]).optional(),
    quietHoursEnd: z.union([z.string().regex(QUIET_HOUR, 'Format attendu : HH:mm.'), z.null()]).optional(),
    minimumPriority: z.enum(PRIORITIES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Au moins un réglage doit être modifié.');

// Contrat interne (Jour 3, `/internal/v1/notifications`) : les producteurs
// (worker en SQL direct, Express en direct) parlent déjà le vocabulaire de
// schema.prisma — majuscules — donc pas de conversion ici, contrairement au
// contrat public au-dessus.
const INTERNAL_TYPES = [
  'PRIORITY_COMMENT',
  'NEGATIVE_COMMENT',
  'URGENT_COMMENT',
  'AI_RESPONSE_READY',
  'PUBLICATION_PUBLISHED',
  'PUBLICATION_FAILED',
  'PUBLICATION_PARTIAL',
  'TOKEN_EXPIRING',
  'TOKEN_EXPIRED',
  'SYNC_FAILED',
  'ACCOUNT_DISCONNECTED',
];
const INTERNAL_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const INTERNAL_RESOURCE_TYPES = ['COMMENT', 'PUBLICATION', 'SOCIAL_ACCOUNT'];
const INTERNAL_NETWORKS = ['FACEBOOK', 'INSTAGRAM'];

export const createNotificationInternalSchema = z.object({
  userId: z.uuid(),
  brandId: z.uuid().optional(),
  type: z.enum(INTERNAL_TYPES),
  priority: z.enum(INTERNAL_PRIORITIES).default('MEDIUM'),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1),
  network: z.enum(INTERNAL_NETWORKS).optional(),
  resourceType: z.enum(INTERNAL_RESOURCE_TYPES).optional(),
  resourceId: z.uuid().optional(),
  // Identifie l'événement métier d'origine (ex. `comment-analysis:{analysisId}:PRIORITY_COMMENT`,
  // `publication:{id}:PUBLISHED`) : c'est la clé de déduplication, distincte
  // par destinataire (voir @@unique([eventId, userId]) dans schema.prisma) —
  // un producteur peut rejouer sans risque de doublon.
  eventId: z.string().trim().min(1).max(150),
});

export { PLATFORMS, PRIORITIES, TYPES };
