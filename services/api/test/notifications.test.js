import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listNotificationsQuerySchema,
  notificationIdSchema,
  registerDeviceTokenSchema,
  removeDeviceTokenSchema,
  updateNotificationSettingsSchema,
} from '../src/notifications/schemas.js';
import { isWithinQuietHours, toPublicNotification } from '../src/notifications/service.js';

const UUID = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';

test('notification id must be a uuid', () => {
  assert.throws(() => notificationIdSchema.parse('nope'));
  assert.equal(notificationIdSchema.parse(UUID), UUID);
});

test('listing notifications defaults to filter=all and page 1', () => {
  const parsed = listNotificationsQuerySchema.parse({});
  assert.equal(parsed.filter, 'all');
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 20);
});

// Mêmes quatre filtres que `notificationsApi.list()` côté mobile — un
// cinquième casserait la façade sans que l'écran ne change de signature.
test('listing notifications only accepts the four filters the mobile screen uses', () => {
  for (const filter of ['all', 'unread', 'priority', 'errors']) {
    assert.equal(listNotificationsQuerySchema.parse({ filter }).filter, filter);
  }
  assert.throws(() => listNotificationsQuerySchema.parse({ filter: 'archived' }));
});

test('listing notifications bounds the page size', () => {
  assert.throws(() => listNotificationsQuerySchema.parse({ pageSize: 0 }));
  assert.throws(() => listNotificationsQuerySchema.parse({ pageSize: 101 }));
  assert.equal(listNotificationsQuerySchema.parse({ pageSize: 100 }).pageSize, 100);
});

test('registering a device token requires a platform Firebase actually supports', () => {
  assert.deepEqual(registerDeviceTokenSchema.parse({ token: 'fcm-token-1', platform: 'android' }), {
    token: 'fcm-token-1',
    platform: 'android',
  });
  assert.throws(() => registerDeviceTokenSchema.parse({ token: 'fcm-token-1', platform: 'windows' }));
  assert.throws(() => registerDeviceTokenSchema.parse({ platform: 'ios' }));
  assert.throws(() => registerDeviceTokenSchema.parse({ token: '' , platform: 'ios' }));
});

test('removing a device token requires a non-empty token', () => {
  assert.throws(() => removeDeviceTokenSchema.parse({}));
  assert.equal(removeDeviceTokenSchema.parse({ token: 'fcm-token-1' }).token, 'fcm-token-1');
});

test('updating notification settings requires at least one field', () => {
  assert.throws(() => updateNotificationSettingsSchema.parse({}));
  assert.deepEqual(updateNotificationSettingsSchema.parse({ sound: false }), { sound: false });
});

test('quiet hours must be HH:mm, but can be cleared with null', () => {
  assert.equal(updateNotificationSettingsSchema.parse({ quietHoursStart: '22:00' }).quietHoursStart, '22:00');
  assert.equal(updateNotificationSettingsSchema.parse({ quietHoursStart: null }).quietHoursStart, null);
  assert.throws(() => updateNotificationSettingsSchema.parse({ quietHoursStart: '22h00' }));
  assert.throws(() => updateNotificationSettingsSchema.parse({ quietHoursStart: '25:00' }));
});

test('minimum priority only accepts the three known levels', () => {
  assert.equal(updateNotificationSettingsSchema.parse({ minimumPriority: 'medium' }).minimumPriority, 'medium');
  assert.throws(() => updateNotificationSettingsSchema.parse({ minimumPriority: 'urgent' }));
});

// La forme publique doit rester alignée sur `AppNotification` côté mobile
// (social-media/src/types/index.ts) : c'est ce qui permet un jour de
// rebrancher `notificationsApi` sans toucher à l'écran.
test('a stored notification is lowercased on the wire, read is derived from readAt', () => {
  const notification = toPublicNotification({
    id: UUID,
    type: 'PRIORITY_COMMENT',
    title: 'Commentaire prioritaire',
    message: 'Karim B. sur Instagram — réclamation à traiter.',
    priority: 'HIGH',
    createdAt: new Date('2026-09-13T09:35:00.000Z'),
    readAt: null,
    network: 'INSTAGRAM',
    resourceType: 'COMMENT',
    resourceId: 'cmt_1',
  });

  assert.equal(notification.type, 'priority_comment');
  assert.equal(notification.priority, 'high');
  assert.equal(notification.network, 'instagram');
  assert.equal(notification.read, false);
  assert.equal(notification.href, '/comments/cmt_1');
});

test('a read notification reports read: true', () => {
  const notification = toPublicNotification({
    id: UUID,
    type: 'PUBLICATION_PUBLISHED',
    title: 'Publication publiée',
    message: '« Nouvelle collection été » envoyée sur Facebook.',
    priority: 'LOW',
    createdAt: new Date('2026-09-13T09:35:00.000Z'),
    readAt: new Date('2026-09-13T10:00:00.000Z'),
    network: 'FACEBOOK',
    resourceType: 'PUBLICATION',
    resourceId: 'pub_1',
  });

  assert.equal(notification.read, true);
  assert.equal(notification.href, '/publications/pub_1');
});

// Sans ressource précise (ex. plusieurs réponses IA générées), la route
// retombe sur un écran générique plutôt que de fabriquer un lien invalide.
test('a notification without a specific resource falls back to a generic route', () => {
  const notification = toPublicNotification({
    id: UUID,
    type: 'AI_RESPONSE_READY',
    title: '3 réponses IA à valider',
    message: 'Propositions générées pour des commentaires négatifs.',
    priority: 'MEDIUM',
    createdAt: new Date('2026-09-13T09:35:00.000Z'),
    readAt: null,
    network: null,
    resourceType: null,
    resourceId: null,
  });

  assert.equal(notification.network, null);
  assert.equal(notification.href, '/comments');
});

test('quiet hours within the same day (no midnight crossing)', () => {
  assert.equal(isWithinQuietHours('13:00', '12:00', '14:00'), true);
  assert.equal(isWithinQuietHours('11:00', '12:00', '14:00'), false);
  assert.equal(isWithinQuietHours('15:00', '12:00', '14:00'), false);
});

// Le cas réel du sprint : 22:00 -> 07:00 chevauche minuit, la plage
// silencieuse est donc "après 22:00 OU avant 07:00", pas un intervalle vide.
test('quiet hours crossing midnight (e.g. 22:00 -> 07:00)', () => {
  assert.equal(isWithinQuietHours('23:30', '22:00', '07:00'), true);
  assert.equal(isWithinQuietHours('03:00', '22:00', '07:00'), true);
  assert.equal(isWithinQuietHours('12:00', '22:00', '07:00'), false);
  assert.equal(isWithinQuietHours('22:00', '22:00', '07:00'), true);
  assert.equal(isWithinQuietHours('07:00', '22:00', '07:00'), false);
});

test('quiet hours are inactive when unset or equal (empty range)', () => {
  assert.equal(isWithinQuietHours('23:30', null, null), false);
  assert.equal(isWithinQuietHours('23:30', '22:00', '22:00'), false);
  assert.equal(isWithinQuietHours(null, '22:00', '07:00'), false);
});

test('a token/sync notification routes to the social accounts settings screen', () => {
  const notification = toPublicNotification({
    id: UUID,
    type: 'TOKEN_EXPIRED',
    title: 'Token Instagram expiré',
    message: 'Reconnectez @studio.vega pour reprendre les envois.',
    priority: 'HIGH',
    createdAt: new Date('2026-09-13T09:35:00.000Z'),
    readAt: null,
    network: 'INSTAGRAM',
    resourceType: 'SOCIAL_ACCOUNT',
    resourceId: 'acc_1',
  });

  assert.equal(notification.href, '/settings/social-accounts');
});
