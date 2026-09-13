/**
 * NotificationPushService (Sprint 11, Jour 2) — service unique qui centralise
 * tous les appels à Firebase Cloud Messaging. Rien d'autre dans le code base
 * n'appelle `firebase-admin` directement.
 *
 * Invariant central du sprint : la notification est déjà persistée et
 * committée AVANT que cette fonction soit appelée (voir le producteur, Jour
 * 3). Un échec ici — Firebase indisponible, non configuré, tokens invalides —
 * ne doit donc jamais remonter comme une erreur à l'appelant : il ne reste
 * qu'à journaliser et, le cas échéant, désactiver les tokens fautifs.
 */

import { prisma } from '../db/prisma.js';
import { getFirebaseApp, isFirebaseConfigured } from '../lib/firebase.js';

// Version du contrat, pas du code : ne change que si la FORME du payload
// change de façon incompatible pour un client mobile déjà installé.
export const FCM_PAYLOAD_VERSION = '1';

// FCM exige des chaînes pour toutes les valeurs `data` : un champ absent est
// une chaîne vide plutôt qu'un `null`/`undefined`, que le SDK Admin rejette.
export function buildPushPayload(notification) {
  return {
    version: FCM_PAYLOAD_VERSION,
    eventId: notification.eventId,
    type: notification.type.toLowerCase(),
    notificationId: notification.id,
    resourceType: notification.resourceType ? notification.resourceType.toLowerCase() : '',
    resourceId: notification.resourceId ?? '',
    brandId: notification.brandId ?? '',
  };
}

// Message « data-only » (pas de bloc `notification`) : c'est ce qui permet à
// l'app de gérer elle-même l'affichage et la déduplication par `eventId` au
// premier plan, en arrière-plan ET application fermée (Jour 4) — un message
// avec bloc `notification` est affiché directement par l'OS sur Android dès
// que l'app n'est pas au premier plan, sans repasser par le JS.
export function androidPriorityFor(priority) {
  return priority === 'HIGH' ? 'high' : 'normal';
}

export function apnsPriorityFor(priority) {
  return priority === 'HIGH' ? '10' : '5';
}

// Les deux seuls codes FCM qui signifient « ce token n'existe plus » —
// tout le reste (quota, erreur serveur, argument invalide) est transitoire
// ou un bug de configuration, pas une raison de perdre l'appareil.
const STALE_TOKEN_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

export function isStaleTokenErrorCode(code) {
  return STALE_TOKEN_CODES.has(code);
}

function buildMessage(notification, tokens) {
  const priority = notification.priority;
  return {
    tokens,
    data: buildPushPayload(notification),
    android: { priority: androidPriorityFor(priority) },
    apns: { headers: { 'apns-priority': apnsPriorityFor(priority) } },
  };
}

/** Envoie une notification déjà persistée à tous les appareils actifs de son
 * destinataire (`notification.userId`) — jamais à un autre utilisateur, et
 * jamais reconstruite à partir d'autre chose que la ligne fournie. Ne throw
 * jamais : voir l'invariant en tête de fichier. */
export async function pushNotification(notification) {
  if (!isFirebaseConfigured()) {
    console.warn({ scope: 'push', reason: 'firebase_not_configured', notificationId: notification.id });
    return { sent: 0, disabled: 0 };
  }

  const tokens = await prisma.deviceToken.findMany({
    where: { userId: notification.userId, disabledAt: null },
  });
  if (tokens.length === 0) return { sent: 0, disabled: 0 };

  let app;
  try {
    app = getFirebaseApp();
  } catch (error) {
    console.error({ scope: 'push', error: error?.message, notificationId: notification.id });
    return { sent: 0, disabled: 0 };
  }

  let response;
  try {
    response = await app.messaging().sendEachForMulticast(
      buildMessage(
        notification,
        tokens.map((deviceToken) => deviceToken.token)
      )
    );
  } catch (error) {
    console.error({ scope: 'push', error: error?.message, notificationId: notification.id });
    return { sent: 0, disabled: 0 };
  }

  const staleIds = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    if (isStaleTokenErrorCode(result.error?.code)) {
      staleIds.push(tokens[index].id);
    } else {
      console.error({ scope: 'push', error: result.error?.message, deviceTokenId: tokens[index].id });
    }
  });

  if (staleIds.length > 0) {
    await prisma.deviceToken.updateMany({ where: { id: { in: staleIds } }, data: { disabledAt: new Date() } });
  }

  return { sent: response.successCount, disabled: staleIds.length };
}
