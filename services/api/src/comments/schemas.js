import { z } from 'zod';

// Sprint 08 native states only — see services/api/prisma/schema.prisma's
// CommentStatus enum comment for why ANALYZING/ANALYZED/IN_PROGRESS from the
// sprint spec's own list are deliberately absent (nothing in this sprint
// sets or reads them). Lowercase on the wire, uppercase in Prisma — same
// "one canonical vocabulary, no translation table" convention as AccountStatus.
const STATUSES = ['new', 'processed', 'ignored', 'escalated'];
const PROVIDERS = ['facebook', 'instagram'];
// Mêmes valeurs que l'énumération Prisma et que le dataset annoté
// (services/ai-service/dataset/ANNOTATION_GUIDE.md) : minuscules sur le fil,
// majuscules en base, aucune table de correspondance.
const SENTIMENTS = ['positive', 'neutral', 'negative'];
const INTENTS = ['question', 'info_request', 'complaint', 'claim', 'other'];
const PRIORITIES = ['low', 'medium', 'high'];

export const commentIdSchema = z.uuid();

export const listCommentsQuerySchema = z.object({
  brandId: z.uuid(),
  status: z.enum([...STATUSES, 'all']).optional(),
  network: z.enum(PROVIDERS).optional(),
  publicationId: z.uuid().optional(),
  search: z.string().trim().max(120).optional(),
  // Filtres issus de l'analyse (Sprint 09). Un commentaire non encore analysé
  // n'a pas de sentiment : il sort des résultats dès qu'un de ces filtres est
  // posé, plutôt que d'être rangé arbitrairement dans « neutre ».
  sentiment: z.enum([...SENTIMENTS, 'all']).optional(),
  intent: z.enum([...INTENTS, 'all']).optional(),
  priority: z.enum([...PRIORITIES, 'all']).optional(),
  sort: z.enum(['recent', 'priority']).default('recent'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const commentsCountQuerySchema = z.object({ brandId: z.uuid() });

export const syncCommentsSchema = z.object({ brandId: z.uuid() });

// `new` is a system-only initial state (set by the webhook/sync, never a
// manual action) — deliberately not accepted here, matching the mobile's
// existing "Traiter" action which only ever moves a comment forward, never
// back to unaddressed.
export const setCommentStatusSchema = z.object({
  status: z.enum(['processed', 'ignored', 'escalated']),
  note: z.string().trim().max(1000).optional(),
});

export const escalateCommentSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
