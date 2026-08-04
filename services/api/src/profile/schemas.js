import { z } from 'zod';

const languageSchema = z.enum(['fr', 'en', 'ar']);

function isValidTimezone(value) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
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
  .refine(isValidTimezone, 'Fuseau horaire IANA invalide.');

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9][0-9 .()\-]{5,28}$/, 'NumÃ©ro de tÃ©lÃ©phone invalide.')
  .max(30);

export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(2).max(80).optional(),
    lastName: z.string().trim().min(2).max(80).optional(),
    displayName: z.string().trim().min(2).max(100).optional(),
    phone: z.union([phoneSchema, z.literal(null)]).optional(),
    language: languageSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Au moins un champ doit Ãªtre modifiÃ©.');

export const updatePreferencesSchema = z
  .object({
    weeklyDigest: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    weekStartsOn: z.enum(['monday', 'sunday']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Au moins une prÃ©fÃ©rence doit Ãªtre modifiÃ©.');

export const avatarMetadataSchema = z.object({
  bucket: z.string().trim().min(1).max(100).default('hootly'),
  objectKey: z.string().trim().min(1).max(1024),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
  width: z.number().int().positive().max(10_000).optional(),
  height: z.number().int().positive().max(10_000).optional(),
  checksum: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).optional(),
});
