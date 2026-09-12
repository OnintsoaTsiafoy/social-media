import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { loadComment } from './middleware.js';
import {
  commentsCountQuerySchema,
  escalateCommentSchema,
  listCommentsQuerySchema,
  replyCommentSchema,
  setCommentStatusSchema,
  syncCommentsSchema,
} from './schemas.js';
import {
  commentsCounts,
  getComment,
  getCommentHistory,
  listComments,
  replyToComment,
  setCommentStatus,
  syncBrandComments,
} from './service.js';

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

router.use(requireAuthentication);

router.get(
  '/',
  (request, _response, next) => {
    try {
      request.brandId = parse(listCommentsQuerySchema, request.query).brandId;
      next();
    } catch (error) {
      next(error);
    }
  },
  requireBrandAccess(),
  async (request, response) => {
    const { brandId, ...filters } = parse(listCommentsQuerySchema, request.query);
    sendSuccess(response, await listComments(brandId, filters));
  }
);

router.get(
  '/counts',
  (request, _response, next) => {
    try {
      request.brandId = parse(commentsCountQuerySchema, request.query).brandId;
      next();
    } catch (error) {
      next(error);
    }
  },
  requireBrandAccess(),
  async (request, response) => {
    sendSuccess(response, await commentsCounts(request.brandId));
  }
);

router.post(
  '/sync',
  (request, _response, next) => {
    try {
      request.brandId = parse(syncCommentsSchema, request.body).brandId;
      next();
    } catch (error) {
      next(error);
    }
  },
  requireBrandAccess(),
  async (request, response) => {
    sendSuccess(response, await syncBrandComments(request.brandId));
  }
);

router.get('/:commentId', loadComment('VIEWER'), async (request, response) => {
  sendSuccess(response, await getComment(request.comment));
});

router.get('/:commentId/history', loadComment('VIEWER'), async (request, response) => {
  sendSuccess(response, await getCommentHistory(request.comment));
});

router.patch('/:commentId/status', loadComment('COMMUNITY_MANAGER'), async (request, response) => {
  const { status, note } = parse(setCommentStatusSchema, request.body);
  sendSuccess(
    response,
    await setCommentStatus({ userId: request.auth.user.id, comment: request.comment, toStatus: status, note }, request)
  );
});

router.post('/:commentId/escalate', loadComment('COMMUNITY_MANAGER'), async (request, response) => {
  const { note } = parse(escalateCommentSchema, request.body ?? {});
  sendSuccess(
    response,
    await setCommentStatus({ userId: request.auth.user.id, comment: request.comment, toStatus: 'escalated', note }, request)
  );
});

router.post('/:commentId/reply', loadComment('COMMUNITY_MANAGER'), async (request, response) => {
  const { text } = parse(replyCommentSchema, request.body);
  sendSuccess(response, await replyToComment({ userId: request.auth.user.id, comment: request.comment, text }, request));
});

export { router as commentRouter };
