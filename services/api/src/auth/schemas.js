import { z } from 'zod';

const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
  .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères.')
  .refine((value) => /[a-zÀ-ÿ]/.test(value), 'Le mot de passe doit contenir une minuscule.')
  .refine((value) => /[A-ZÀ-Ÿ]/.test(value), 'Le mot de passe doit contenir une majuscule.')
  .refine((value) => /\d/.test(value), 'Le mot de passe doit contenir un chiffre.');

const emailSchema = z.string().trim().toLowerCase().email('Adresse email invalide.').max(320);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(2).max(80),
  lastName: z.string().trim().min(2).max(80),
  displayName: z.string().trim().min(2).max(100).optional(),
  language: z.enum(['fr', 'en', 'ar']).default('fr'),
  timezone: z.string().trim().min(1).max(64).default('Europe/Paris'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(2048),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(2048),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const sessionIdSchema = z.uuid('Identifiant de session invalide.');

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
});
