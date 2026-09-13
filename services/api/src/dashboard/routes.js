import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { dashboardQuerySchema } from './schemas.js';
import { dashboardPriorityComments, dashboardSummary, dashboardUpcomingPublications } from './service.js';

const router = express.Router();

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'validation_failed',
    'Les données envoyées ne sont pas valides.',
    result.error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.code, message: issue.message }))
  );
}

function withBrandQuery(request, _response, next) {
  try {
    request.brandId = parse(dashboardQuerySchema, request.query).brandId;
    next();
  } catch (error) {
    next(error);
  }
}

router.use(requireAuthentication);

router.get('/summary', withBrandQuery, requireBrandAccess(), async (request, response) => {
  sendSuccess(response, await dashboardSummary(request.brandId));
});

router.get('/priority-comments', withBrandQuery, requireBrandAccess(), async (request, response) => {
  sendSuccess(response, await dashboardPriorityComments(request.brandId));
});

router.get('/upcoming-publications', withBrandQuery, requireBrandAccess(), async (request, response) => {
  sendSuccess(response, await dashboardUpcomingPublications(request.brandId));
});

export { router as dashboardRouter };
