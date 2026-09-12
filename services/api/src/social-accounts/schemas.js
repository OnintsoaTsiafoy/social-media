import { z } from 'zod';

export const providerParamSchema = z.enum(['facebook', 'instagram']);

export const connectSchema = z.object({
  brandId: z.uuid('Identifiant de marque invalide.'),
  mobileRedirectUri: z.string().trim().min(1).max(2048),
});

export const oauthStatusQuerySchema = z.object({
  state: z.string().trim().min(1).max(512),
});

export const listAccountsQuerySchema = z.object({
  brandId: z.uuid('Identifiant de marque invalide.'),
});

export const socialAccountIdSchema = z.uuid('Identifiant de compte social invalide.');
