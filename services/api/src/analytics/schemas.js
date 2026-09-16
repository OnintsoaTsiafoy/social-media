import { z } from 'zod';

const NETWORKS = ['facebook', 'instagram'];

export const periodSchema = z.enum(['7d', '30d', '90d']).default('30d');
export const networkFilterSchema = z.enum([...NETWORKS, 'all']).default('all');

export const syncAnalyticsSchema = z.object({ brandId: z.uuid() });

export const analyticsQuerySchema = z.object({
  brandId: z.uuid(),
  period: periodSchema,
  network: networkFilterSchema,
});

// La timeline est fixée sur 4 semaines glissantes (voir service.js) — pas de
// paramètre period, contrairement aux autres routes.
export const timelineQuerySchema = z.object({
  brandId: z.uuid(),
  network: networkFilterSchema,
});

export const topPublicationsQuerySchema = analyticsQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export const publicationAnalyticsQuerySchema = z.object({ brandId: z.uuid() });

export const insightQuerySchema = analyticsQuerySchema.strict();
export const insightHistorySchema = insightQuerySchema.extend({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(10),
});
export const insightIdSchema = z.object({ insightId: z.uuid() });
export const insightBrandSchema = publicationAnalyticsQuerySchema.strict();
export const insightFeedbackSchema = z.object({
  useful: z.boolean(), comment: z.string().trim().max(1000).default(''),
}).strict();

// `network` est ici obligatoire et exclut `all`, contrairement à
// networkFilterSchema : le TODO du meilleur horaire demande de séparer
// Facebook et Instagram (des habitudes de publication différentes), jamais de
// les mélanger dans un même classement de créneaux.
export const bestTimesNetworkSchema = z.enum(NETWORKS);

export const bestTimesQuerySchema = z.object({
  brandId: z.uuid(),
  network: bestTimesNetworkSchema,
  period: periodSchema,
  // Fuseau explicite demandé par le TODO (endpoint section) : Brand n'a pas
  // de colonne timezone, donc l'appelant le précise plutôt que de le déduire.
  timezone: z.string().min(1).max(64).default('Europe/Paris'),
});
