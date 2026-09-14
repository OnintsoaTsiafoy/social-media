import { z } from 'zod';

// Mêmes valeurs que l'énumération Prisma `AiTone` et que TONE_OPTIONS côté
// mobile — minuscules sur le fil, majuscules en base.
const TONES = ['professional', 'friendly', 'empathetic', 'formal', 'custom'];
const LANGUAGES = ['fr', 'en', 'ar'];

// Aligné sur MAX_RESPONSE_LENGTH de l'éditeur de réponse mobile et sur
// `max_response_characters` du service d'analyse : les trois doivent bouger
// ensemble, sinon une proposition acceptée ici serait rejetée là-bas.
const MAX_RESPONSE_LENGTH = 500;

export const suggestionIdSchema = z.uuid();

export const listSuggestionsQuerySchema = z.object({
  commentId: z.uuid(),
});

// `text` absent : la proposition est générée par l'IA. `text` fourni : le
// community manager a rédigé lui-même, on enregistre sa version telle quelle
// (et on la contrôle quand même — c'est là que les engagements non autorisés
// apparaissent le plus souvent).
export const createSuggestionSchema = z.object({
  commentId: z.uuid(),
  text: z.string().trim().min(1).max(MAX_RESPONSE_LENGTH).optional(),
  tone: z.enum(TONES).optional(),
  language: z.enum(LANGUAGES).optional(),
  instruction: z.string().trim().max(1000).optional(),
  strategy: z.enum(['llm', 'rag', 'rag_feedback']).default('rag_feedback'),
});

export const updateSuggestionSchema = z.object({
  text: z.string().trim().min(1).max(MAX_RESPONSE_LENGTH),
  tone: z.enum(TONES).optional(),
  language: z.enum(LANGUAGES).optional(),
});

// `text` optionnel : permet d'approuver la dernière version telle quelle, ou
// d'approuver une ultime retouche en une seule requête — l'écran mobile
// n'oblige pas à enregistrer avant d'approuver.
export const approveSuggestionSchema = z.object({
  text: z.string().trim().min(1).max(MAX_RESPONSE_LENGTH).optional(),
  reason: z.string().trim().max(500).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  feedbackComment: z.string().trim().max(1000).optional(),
});

export const rejectSuggestionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  feedbackComment: z.string().trim().max(1000).optional(),
});

export const regenerateSuggestionSchema = createSuggestionSchema.omit({ commentId: true, text: true });

export const generateHashtagsSchema = z.object({
  brandId: z.uuid(),
  text: z.string().trim().min(1).max(10_000),
  preserve: z.array(z.string().trim().max(80)).max(30).optional(),
});

export { MAX_RESPONSE_LENGTH };
