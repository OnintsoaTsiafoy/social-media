import { z } from 'zod';

/** Le contrat public est en minuscules ; la base stocke des enums majuscules. */
export const PROVIDERS = ['facebook', 'instagram'];
export const STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'partially_published',
  'failed',
  'cancelled',
];

const providerSchema = z.enum(PROVIDERS);
const languageSchema = z.enum(['fr', 'en', 'ar']);
const hashtagsSchema = z.array(z.string().trim().min(1).max(80)).max(30);

/** ADR-08 : une image par publication tant que le MVP média n'est pas étendu. */
export const MAX_MEDIA_PER_PUBLICATION = 1;

function isKnownTimezone(value) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isKnownTimezone, 'Fuseau horaire inconnu.');

const targetSchema = z.object({
  provider: providerSchema,
  socialAccountId: z.uuid().nullable().optional(),
  adaptedContent: z.string().trim().max(5000).nullable().optional(),
  adaptedHashtags: hashtagsSchema.optional(),
});

const targetsSchema = z
  .array(targetSchema)
  .max(PROVIDERS.length)
  .refine(
    (targets) => new Set(targets.map((target) => target.provider)).size === targets.length,
    'Un même réseau ne peut être ciblé deux fois.'
  );

export const publicationIdSchema = z.uuid('Identifiant de publication invalide.');

export const createPublicationSchema = z.object({
  brandId: z.uuid('Identifiant de marque invalide.'),
  content: z.string().trim().min(1, 'Le texte de la publication est obligatoire.').max(5000),
  language: languageSchema.default('fr'),
  hashtags: hashtagsSchema.default([]),
  mediaIds: z.array(z.uuid()).max(MAX_MEDIA_PER_PUBLICATION).default([]),
  targets: targetsSchema.default([]),
  timezone: timezoneSchema.default('Europe/Paris'),
});

export const updatePublicationSchema = z
  .object({
    content: z.string().trim().min(1).max(5000).optional(),
    language: languageSchema.optional(),
    hashtags: hashtagsSchema.optional(),
    mediaIds: z.array(z.uuid()).max(MAX_MEDIA_PER_PUBLICATION).optional(),
    targets: targetsSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Au moins un champ doit être modifié.');

export const listPublicationSchema = z.object({
  brandId: z.uuid().optional(),
  status: z.enum([...STATUSES, 'all']).optional(),
  provider: providerSchema.optional(),
  search: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const countPublicationSchema = z.object({ brandId: z.uuid().optional() });

export const calendarSchema = z
  .object({
    brandId: z.uuid().optional(),
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((value) => value.from <= value.to, 'La période demandée est invalide.')
  .refine(
    (value) => value.to.getTime() - value.from.getTime() <= 366 * 24 * 60 * 60 * 1000,
    'La période demandée ne peut pas dépasser un an.'
  );

/**
 * Une planification est toujours reçue en instant absolu (ISO avec décalage) et
 * stockée en UTC ; `timezone` ne sert qu'à réafficher l'heure locale voulue.
 */
export const schedulePublicationSchema = z.object({
  scheduledAt: z.coerce.date(),
  timezone: timezoneSchema.optional(),
});

export const retryPublicationSchema = z.object({
  provider: providerSchema.optional(),
});
