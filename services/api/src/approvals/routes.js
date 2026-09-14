import express from 'express';
import { requireAuthentication } from '../auth/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { loadPublication, requireBrandFromBody } from '../publications/middleware.js';
import { approvalDecisionSchema, approvalListSchema, approvalRejectionSchema, historyQuerySchema, requestApprovalSchema } from './schemas.js';
import { approvalHistory, approvalMembers, changeApproval, listApprovals } from './service.js';

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, 'validation_failed', 'Les données envoyées ne sont pas valides.',
    result.error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.code, message: issue.message })));
  return result.data;
}

export const publicationApprovalRouter = express.Router();
publicationApprovalRouter.use(requireAuthentication);
for (const action of ['request-approval', 'approve', 'reject', 'request-changes', 'cancel-approval']) {
  const review = ['approve', 'reject', 'request-changes'].includes(action);
  const schema = action === 'request-approval' ? requestApprovalSchema
    : ['reject', 'request-changes'].includes(action) ? approvalRejectionSchema : approvalDecisionSchema;
  publicationApprovalRouter.post(`/:publicationId/${action}`, loadPublication(review ? 'ADMIN' : 'COMMUNITY_MANAGER'), async (request, response) => {
    sendSuccess(response, await changeApproval(request.auth.user, request.publication, action,
      parse(schema, request.body ?? {}), request), action === 'request-approval' ? 201 : 200);
  });
}
publicationApprovalRouter.get('/:publicationId/approval-history', loadPublication('VIEWER'), async (request, response) => {
  sendSuccess(response, await approvalHistory(request.publication.id, parse(historyQuerySchema, request.query)));
});

export const approvalsRouter = express.Router();
approvalsRouter.use(requireAuthentication);
approvalsRouter.get('/members', async (request, response) => {
  const { brandId } = parse(approvalListSchema, request.query);
  if (!brandId) throw new HttpError(400, 'validation_failed', 'La marque est obligatoire.');
  await requireBrandFromBody(request, brandId, 'VIEWER');
  sendSuccess(response, await approvalMembers(brandId));
});
approvalsRouter.get('/', async (request, response) => {
  const filters = parse(approvalListSchema, request.query);
  if (filters.brandId) await requireBrandFromBody(request, filters.brandId, 'ADMIN');
  sendSuccess(response, await listApprovals(request.auth.user.id, filters));
});
