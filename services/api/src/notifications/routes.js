import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { loadNotification } from './middleware.js';
import {
  listNotificationsQuerySchema,
  registerDeviceTokenSchema,
  removeDeviceTokenSchema,
  updateNotificationSettingsSchema,
} from './schemas.js';
import {
  getNotificationSettings,
  listNotifications,
  markAllRead,
  markRead,
  registerDeviceToken,
  removeDeviceToken,
  unreadCount,
  updateNotificationSettings,
} from './service.js';

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

export const notificationRouter = express.Router();
notificationRouter.use(requireAuthentication);

notificationRouter.get('/', async (request, response) => {
  const query = parse(listNotificationsQuerySchema, request.query);
  sendSuccess(response, await listNotifications(request.auth.user.id, query));
});

// Monté AVANT `/:notificationId/read` implicitement puisqu'il s'agit d'un
// chemin distinct (`/unread-count`), mais listé ici en premier par lisibilité.
notificationRouter.get('/unread-count', async (request, response) => {
  sendSuccess(response, { count: await unreadCount(request.auth.user.id) });
});

notificationRouter.patch('/:notificationId/read', loadNotification, async (request, response) => {
  sendSuccess(response, await markRead(request.notification));
});

notificationRouter.post('/read-all', async (request, response) => {
  sendSuccess(response, await markAllRead(request.auth.user.id));
});

// Pas de route de création : une notification n'est jamais créée par le
// client, seulement par les producteurs serveur du Jour 3 (analyse,
// génération de réponse, publication, événements de token).
export const deviceTokenRouter = express.Router();
deviceTokenRouter.use(requireAuthentication);

deviceTokenRouter.post('/', async (request, response) => {
  const body = parse(registerDeviceTokenSchema, request.body);
  sendSuccess(response, await registerDeviceToken(request.auth.user.id, body), 201);
});

// Le token voyage dans le corps (pas de segment d'URL) : c'est le contrat
// listé par la fiche du sprint.
deviceTokenRouter.delete('/', async (request, response) => {
  const { token } = parse(removeDeviceTokenSchema, request.body ?? {});
  await removeDeviceToken(request.auth.user.id, token);
  response.status(204).end();
});

export const notificationSettingsRouter = express.Router();
notificationSettingsRouter.use(requireAuthentication);

notificationSettingsRouter.get('/', async (request, response) => {
  sendSuccess(response, await getNotificationSettings(request.auth.user.id));
});

notificationSettingsRouter.patch('/', async (request, response) => {
  const patch = parse(updateNotificationSettingsSchema, request.body);
  sendSuccess(response, await updateNotificationSettings(request.auth.user.id, patch));
});
