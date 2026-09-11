import { z } from 'zod';

/** Limites alignées sur celles que le mobile applique avant l'envoi. */
export const MEDIA_LIMITS = {
  maxBytes: Number(process.env.MEDIA_MAX_BYTES ?? 8_000_000) || 8_000_000,
  minDimension: Number(process.env.MEDIA_MIN_DIMENSION ?? 320) || 320,
};

export const mediaIdSchema = z.uuid('Identifiant de média invalide.');

export const uploadMediaSchema = z.object({
  brandId: z.uuid('Identifiant de marque invalide.').optional(),
  purpose: z.enum(['publication', 'avatar']).default('publication'),
  fileName: z.string().trim().min(1).max(255).optional(),
});
