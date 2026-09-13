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
