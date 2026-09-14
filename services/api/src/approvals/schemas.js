import { z } from 'zod';

const comment = z.string().trim().max(2000);
export const requestApprovalSchema = z.object({
  reviewerId: z.uuid().optional(), comment: comment.optional(),
}).strict();
// The ID ties a decision to the displayed request, including after a cancel/resubmit.
export const approvalDecisionSchema = z.object({ approvalId: z.uuid(), comment: comment.optional() }).strict();
export const approvalRejectionSchema = approvalDecisionSchema.extend({
  comment: comment.min(1, 'Expliquez le refus ou les modifications demandées.'),
});
export const approvalListSchema = z.object({
  brandId: z.uuid().optional(),
  status: z.enum(['all', 'pending', 'approved', 'rejected', 'changes_requested', 'cancelled']).default('pending'),
  authorId: z.uuid().optional(), reviewerId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
