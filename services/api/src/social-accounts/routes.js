import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import {
  listAccountsQuerySchema,
  oauthStatusQuerySchema,
  providerParamSchema,
  socialAccountIdSchema,
} from './schemas.js';
import { disconnectAccount, getOAuthStatus, listAccounts, syncAccount } from './service.js';

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

// Connecter une page n'est plus à la portée d'un utilisateur, même propriétaire de la
// marque : seul un administrateur de la plateforme le fait, depuis la console web
// (`POST /api/v1/admin/pages/connect`). La route reste pour répondre clairement aux
// versions de l'application mobile qui l'appellent encore — un 404 y ressemblerait à
// une panne. Elle refuse avant toute lecture du corps : rien n'est lancé côté Meta.
router.post('/:provider/connect', () => {
  throw new HttpError(
    403,
    'forbidden',
    'La connexion d’une page se fait depuis la console d’administration. Contactez un administrateur de la plateforme.'
  );
});

export { router as socialAccountRouter };
