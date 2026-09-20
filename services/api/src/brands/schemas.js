import { z } from 'zod';

const languageSchema = z.enum(['fr', 'en', 'ar']);
const textListSchema = z.array(z.string().trim().min(1).max(120)).max(100);

export const brandIdSchema = z.uuid('Identifiant de marque invalide.');

export const createBrandSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(5000).nullable().optional(),
  industry: z.string().trim().min(1).max(100).nullable().optional(),
  primaryLanguage: languageSchema.default('fr'),
});

export const updateBrandSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    industry: z.string().trim().min(1).max(100).nullable().optional(),
    primaryLanguage: languageSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Au moins un champ doit être modifié.');

export const listBrandSchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  active: z.enum(['true', 'false']).optional(),
});

export const updateAiSettingsSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    tone: z.enum(['professional', 'friendly', 'empathetic', 'formal', 'custom']).optional(),
    customTone: z.string().trim().min(2).max(5000).nullable().optional(),
    formality: z.enum(['informal', 'formal', 'adaptive']).optional(),
    language: languageSchema.optional(),
    emojisAllowed: z.boolean().optional(),
    targetLength: z.enum(['1 phrase', '2 phrases', '3 phrases', 'Libre']).optional(),
    greeting: z.string().trim().max(300).nullable().optional(),
    closing: z.string().trim().max(300).nullable().optional(),
    forbiddenTerms: textListSchema.optional(),
    recommendedTerms: textListSchema.optional(),
    instructions: z.string().trim().max(10_000).nullable().optional(),
    complaintInstructions: z.string().trim().max(10_000).nullable().optional(),
    urgencyInstructions: z.string().trim().max(10_000).nullable().optional(),
    supportInstructions: z.string().trim().max(10_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Au moins un paramètre doit être modifié.')
  .superRefine((value, context) => {
    if (value.tone === 'custom' && !value.customTone?.trim()) {
      context.addIssue({ code: 'custom', path: ['customTone'], message: 'La description du ton personnalisé est requise.' });
    }
  });
