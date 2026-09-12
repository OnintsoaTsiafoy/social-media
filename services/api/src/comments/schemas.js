import { z } from 'zod';

// Sprint 08 native states only — see services/api/prisma/schema.prisma's
// CommentStatus enum comment for why ANALYZING/ANALYZED/IN_PROGRESS from the
// sprint spec's own list are deliberately absent (nothing in this sprint
// sets or reads them). Lowercase on the wire, uppercase in Prisma — same
// "one canonical vocabulary, no translation table" convention as AccountStatus.
const STATUSES = ['new', 'processed', 'ignored', 'escalated'];
const PROVIDERS = ['facebook', 'instagram'];

export const commentIdSchema = z.uuid();

export const listCommentsQuerySchema = z.object({
  brandId: z.uuid(),
  status: z.enum([...STATUSES, 'all']).optional(),
  network: z.enum(PROVIDERS).optional(),
  publicationId: z.uuid().optional(),
  search: z.string().trim().max(120).optional(),
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

export const replyCommentSchema = z.object({
  text: z.string().trim().min(1).max(8000),
});
