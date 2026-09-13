import express from 'express';

import { requireServiceAuth } from '../lib/serviceAuth.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { createNotificationInternalSchema } from './schemas.js';
import { createNotification } from './service.js';

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

// Seul point d'entrée qui permet à un autre service (le worker, aujourd'hui)
// de créer une notification et de déclencher son envoi FCM — Firebase Admin
// ne vivant que dans Express (Jour 2), et la persistance passant toujours
// par la même fonction que les producteurs internes à Express (Jour 3).
export const internalNotificationRouter = express.Router();

internalNotificationRouter.post('/', requireServiceAuth('notifications:write'), async (request, response) => {
  const body = parse(createNotificationInternalSchema, request.body);
  sendSuccess(response, await createNotification(body), 201);
});
