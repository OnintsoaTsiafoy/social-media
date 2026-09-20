import { z } from 'zod';

import { MAX_RESPONSE_LENGTH } from '../response-suggestions/schemas.js';
import { keywordSchema, serviceLevelsSchema } from './settings.js';

// Motifs de rejet proposés par la console. Ce sont des codes stables, pas des
// libellés : `ai_feedback.reason` alimente le jeu de données d'évaluation et ne
// doit pas dépendre de la langue de l'écran qui l'a saisi.
export const REJECT_REASONS = ['wrong_tone', 'incorrect_facts', 'policy_risk', 'too_generic'];

// Mêmes vocabulaires que le reste de l'API (analytics/schemas.js) : minuscules
// sur le fil, `network=all|facebook|instagram`, `period=7d|30d|90d`.
const period = (fallback) => z.enum(['7d', '30d', '90d']).default(fallback);
const network = z.enum(['all', 'facebook', 'instagram']).default('all');
const nonEmpty = (value) => Object.keys(value).length > 0;

export const idSchema = z.uuid();

export const overviewQuerySchema = z.object({ period: period('7d'), network });

export const liveQuerySchema = z.object({ network });

export const trendQuerySchema = z.object({
  metric: z.enum(['engagement', 'response_time', 'sentiment', 'ai_performance']).default('engagement'),
  period: period('30d'),
  sentiment: z.enum(['all', 'positive', 'neutral', 'negative']).default('all'),
  pageId: z.uuid().optional(),
  network,
});

export const pagesPerformanceQuerySchema = z.object({ period: period('30d'), network, pageId: z.uuid().optional() });

export const listUsersQuerySchema = z.object({
  status: z.enum(['all', 'active', 'suspended']).default('all'),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const updateUserSchema = z
  .object({
    status: z.enum(['active', 'suspended']).optional(),
    platformRole: z.enum(['user', 'platform_admin']).optional(),
    // OWNER est volontairement absent : la propriété d'une marque ne se transfère pas ici.
    memberships: z
      .array(z.object({ brandId: z.uuid(), role: z.enum(['admin', 'community_manager', 'viewer']) }).strict())
      .max(50)
      .optional(),
  })
  .strict()
  .refine(nonEmpty, { message: 'Aucune modification demandée.' });

export const listPagesQuerySchema = z.object({
  network,
  status: z.enum(['all', 'healthy', 'attention', 'action_required']).default('all'),
});

export const updatePageSchema = z.object({ autoReply: z.boolean() }).strict();

export const addKeywordSchema = z.object({ word: keywordSchema }).strict();
export { keywordSchema };

export const serviceLevelsPatchSchema = serviceLevelsSchema.partial().strict().refine(nonEmpty, {
  message: 'Aucune modification demandée.',
});

export const supervisionPatchSchema = z
  .object({
    autoReply: z.boolean().optional(),
    threshold: z.number().int().min(50).max(99).optional(),
    rules: z
      .object({
        negative: z.boolean().optional(),
        volume: z.boolean().optional(),
        vip: z.boolean().optional(),
        lang: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(nonEmpty, { message: 'Aucune modification demandée.' });

export const approveDraftSchema = z.object({ text: z.string().trim().min(1).max(MAX_RESPONSE_LENGTH).optional() }).strict();
export const rejectDraftSchema = z.object({ reason: z.enum(REJECT_REASONS) }).strict();
export const escalateSchema = z.object({ note: z.string().trim().max(1000).optional() }).strict();

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
