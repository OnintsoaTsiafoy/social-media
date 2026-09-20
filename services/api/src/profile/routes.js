import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { avatarMetadataSchema, updatePreferencesSchema, updateProfileSchema } from './schemas.js';
import { deleteAvatar, getPreferences, getProfile, saveAvatar, updatePreferences, updateProfile } from './service.js';

const router = express.Router();

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

router.use(requireAuthentication);

router.get('/', async (request, response) => {
  sendSuccess(response, await getProfile(request.auth.user.id));
});

router.patch('/', async (request, response) => {
  sendSuccess(response, await updateProfile(request.auth.user.id, parse(updateProfileSchema, request.body), request));
});

router.get('/preferences', async (request, response) => {
  sendSuccess(response, await getPreferences(request.auth.user.id));
});

router.patch('/preferences', async (request, response) => {
  sendSuccess(
    response,
    await updatePreferences(request.auth.user.id, parse(updatePreferencesSchema, request.body), request)
  );
});

router.post('/avatar', async (request, response) => {
  sendSuccess(response, await saveAvatar(request.auth.user.id, parse(avatarMetadataSchema, request.body), request), 201);
});

router.delete('/avatar', async (request, response) => {
  await deleteAvatar(request.auth.user.id, request);
  response.status(204).end();
});

export { router as profileRouter };
