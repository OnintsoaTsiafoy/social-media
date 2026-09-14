import express from 'express';
import { rateLimit } from 'express-rate-limit';

import { HttpError, sendSuccess } from '../lib/http.js';
import { requireAuthentication } from './middleware.js';
import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  sessionIdSchema,
} from './schemas.js';
import {
  changePassword,
  currentUser,
  deleteAccount,
  listSessions,
  login,
  logout,
  refresh,
  register,
  requestPasswordReset,
  resetPassword,
  revokeAllSessions,
  revokeSession,
} from './service.js';

const router = express.Router();

const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (request, _response, next) => {
    next(new HttpError(429, 'rate_limited', 'Trop de tentatives. Réessayez plus tard.'));
  },
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (request, _response, next) => {
    next(new HttpError(429, 'rate_limited', 'Trop de demandes. Réessayez plus tard.'));
  },
});

function parse(schema, body) {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'validation_failed',
    'Les données envoyées ne sont pas valides.',
    result.error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.code, message: issue.message }))
  );
}

router.post('/register', credentialLimiter, async (request, response) => {
  const data = await register(parse(registerSchema, request.body), request);
  sendSuccess(response, data, 201);
});

router.post('/login', credentialLimiter, async (request, response) => {
  const data = await login(parse(loginSchema, request.body), request);
  sendSuccess(response, data);
});

router.post('/refresh', credentialLimiter, async (request, response) => {
  const { refreshToken } = parse(refreshSchema, request.body);
  const data = await refresh(refreshToken, request);
  sendSuccess(response, data);
});

router.post('/logout', requireAuthentication, async (request, response) => {
  await logout(request.auth, request);
  response.status(204).end();
});

router.get('/me', requireAuthentication, async (request, response) => {
  sendSuccess(response, await currentUser(request.auth));
});

router.post('/forgot-password', resetLimiter, async (request, response) => {
  const { email } = parse(forgotPasswordSchema, request.body);
  await requestPasswordReset(email, request);
  // Always return the same result to avoid revealing whether an account exists.
  sendSuccess(response, { accepted: true }, 202);
});

router.post('/reset-password', resetLimiter, async (request, response) => {
  const { token, password } = parse(resetPasswordSchema, request.body);
  await resetPassword(token, password, request);
  response.status(204).end();
});

router.post('/change-password', requireAuthentication, async (request, response) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, request.body);
  const data = await changePassword(request.auth, currentPassword, newPassword, request);
  sendSuccess(response, data);
});

router.get('/sessions', requireAuthentication, async (request, response) => {
  sendSuccess(response, await listSessions(request.auth));
});

router.delete('/sessions/:id', requireAuthentication, async (request, response) => {
  const id = parse(sessionIdSchema, request.params.id);
  await revokeSession(request.auth, id, request);
  response.status(204).end();
});

router.delete('/sessions', requireAuthentication, async (request, response) => {
  await revokeAllSessions(request.auth, request);
  response.status(204).end();
});

router.delete('/account', requireAuthentication, async (request, response) => {
  const { password } = parse(deleteAccountSchema, request.body);
  await deleteAccount(request.auth, password, request);
  response.status(204).end();
});

export { router as authRouter };
