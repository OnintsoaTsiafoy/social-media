import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import {
  connectSchema,
  listAccountsQuerySchema,
  oauthStatusQuerySchema,
  providerParamSchema,
  socialAccountIdSchema,
} from './schemas.js';
import { disconnectAccount, getOAuthStatus, listAccounts, startConnect, syncAccount } from './service.js';

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

// Express's param-callback signature is (req, res, next, value) — see the
// same fix and its explanation in brands/routes.js.
router.param('provider', (request, _response, next, value) => {
  try {
    request.provider = parse(providerParamSchema, value);
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/oauth/status', async (request, response) => {
  const { state } = parse(oauthStatusQuerySchema, request.query);
  sendSuccess(response, await getOAuthStatus(request.auth.user.id, state));
});

router.get(
  '/',
  (request, _response, next) => {
    try {
      request.brandId = parse(listAccountsQuerySchema, request.query).brandId;
      next();
    } catch (error) {
      next(error);
    }
  },
  requireBrandAccess(),
  async (request, response) => {
    sendSuccess(response, await listAccounts(request.brandId));
  }
);

router.post('/:socialAccountId/sync', async (request, response) => {
  const socialAccountId = parse(socialAccountIdSchema, request.params.socialAccountId);
  sendSuccess(response, await syncAccount({ userId: request.auth.user.id, socialAccountId }, request));
});

router.delete('/:socialAccountId', async (request, response) => {
  const socialAccountId = parse(socialAccountIdSchema, request.params.socialAccountId);
  await disconnectAccount({ userId: request.auth.user.id, socialAccountId }, request);
  response.status(204).end();
});

router.post(
  '/:provider/connect',
  // brandId lives in the body, not the path — set request.brandId before
  // requireBrandAccess so it can find it the same way it does for :brandId
  // routes elsewhere (see brands/middleware.js).
  (request, _response, next) => {
    try {
      request.validatedBody = parse(connectSchema, request.body);
      request.brandId = request.validatedBody.brandId;
      next();
    } catch (error) {
      next(error);
    }
  },
  requireBrandAccess('ADMIN'),
  async (request, response) => {
    const result = await startConnect(
      {
        userId: request.auth.user.id,
        brandId: request.brandId,
        provider: request.provider,
        mobileRedirectUri: request.validatedBody.mobileRedirectUri,
      },
      request
    );
    sendSuccess(response, result, 201);
  }
);

export { router as socialAccountRouter };
