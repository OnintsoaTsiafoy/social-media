/**
 * Sprint 11 — Firebase Cloud Messaging côté mobile.
 *
 * Le backend envoie des messages *data-only* (voir services/api/src/
 * notifications/push.js) : aucun bloc `notification`, donc rien ne s'affiche
 * tout seul, y compris au premier plan — c'est entièrement à cette couche de
 * décider quoi faire. `resourceType`/`resourceId` sont les seules données
 * métier transportées ; le client recharge toujours la ressource via l'API
 * avant d'agir (voir hrefFor ci-dessous, qui ne fait que calculer une route,
 * jamais confiance en un contenu métier venu du push).
 *
 * Portée réelle de ce sprint : Android uniquement. `expo-notifications`
 * renvoie sur Android le vrai token FCM que NotificationPushService peut
 * adresser directement. Sur iOS, ce même appel renvoie un jeton APNs brut —
 * inutilisable tel quel par Firebase Admin sans le pont natif côté iOS
 * (Firebase iOS SDK), qu'aucun projet `ios/` n'existe encore pour builder
 * dans ce dépôt (voir docs/SPRINT_11_FIREBASE_NOTIFICATIONS.md, limites).
 */

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { notificationsApi } from '@/data/api';

export type PushData = {
  version?: string;
  eventId?: string;
  type?: string;
  notificationId?: string;
  resourceType?: string;
  resourceId?: string;
  brandId?: string;
};

// Affiche systématiquement l'alerte nous-mêmes : sans handler explicite,
// expo-notifications n'afficherait rien par défaut pour un message sans
// bloc `notification` (voir le commentaire de tête de fichier).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let currentToken: string | undefined;

// Fenêtre de déduplication en mémoire : un même `eventId` peut arriver deux
// fois (plusieurs appareils du même utilisateur, ou un rejeu réseau côté
// FCM) — voir "test de déduplication" dans la fiche du sprint. Bornée pour
// ne jamais grossir indéfiniment sur une session longue.
const seenEventIds = new Set<string>();
const MAX_SEEN_EVENT_IDS = 200;

function alreadySeen(eventId: string | undefined): boolean {
  if (!eventId) return false;
  if (seenEventIds.has(eventId)) return true;
  seenEventIds.add(eventId);
  if (seenEventIds.size > MAX_SEEN_EVENT_IDS) {
    const oldest = seenEventIds.values().next().value;
    if (oldest !== undefined) seenEventIds.delete(oldest);
  }
  return false;
}

// Miroir de notifications/service.js::hrefFor côté serveur — nécessaire ici
// car le payload FCM ne transporte que resourceType/resourceId, jamais un
// `href` déjà calculé (celui-ci n'existe que dans la réponse REST).
export function hrefFor(data: PushData): string {
  if (data.resourceType === 'comment' && data.resourceId) return `/comments/${data.resourceId}`;
  if (data.resourceType === 'publication' && data.resourceId) return `/publications/${data.resourceId}`;
  if (data.type === 'ai_response_ready') return '/comments';
  if (
    data.type === 'token_expiring' ||
    data.type === 'token_expired' ||
    data.type === 'sync_failed' ||
    data.type === 'account_disconnected'
  ) {
    return '/settings/social-accounts';
  }
  return '/notifications';
}

/** Demande l'autorisation système puis enregistre le token FCM natif de
 * l'appareil. Jamais bloquant : un refus, un simulateur ou une plateforme
 * non supportée laissent l'utilisateur pleinement fonctionnel — REST reste
 * la source de vérité (voir docs/CONTRATS_API.md). */
export async function registerForPushNotifications(): Promise<void> {
  if (!Device.isDevice) return;
  if (Platform.OS !== 'android') return;

  const settings = await Notifications.getPermissionsAsync();
  let status = settings.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return;

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Général',
    importance: Notifications.AndroidImportance.HIGH,
  });

  try {
    const devicePushToken = await Notifications.getDevicePushTokenAsync();
    const token = devicePushToken.data;
    currentToken = token;
    await notificationsApi.registerDeviceToken(token, 'android');
  } catch {
    // Best-effort : réessayé à la prochaine ouverture de session.
  }
}

/** Désassocie le token de cet appareil — appelé à la déconnexion, pour
 * qu'un autre compte connecté ensuite sur le même appareil ne reçoive pas
 * les notifications laissées en attente pour l'utilisateur précédent. */
export async function unregisterForPushNotifications(): Promise<void> {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = undefined;
  try {
    await notificationsApi.removeDeviceToken(token);
  } catch {
    // Le token expirera naturellement si Firebase le signale invalide.
  }
}

/** Firebase renouvelle le token périodiquement ; l'appareil doit rester
 * joignable sans que l'utilisateur ait à se reconnecter. */
export function subscribeToTokenRefresh(): () => void {
  const subscription = Notifications.addPushTokenListener((event) => {
    currentToken = event.data;
    void notificationsApi.registerDeviceToken(event.data, 'android').catch(() => undefined);
  });
  return () => subscription.remove();
}

/** Reçue au premier plan : rien à afficher soi-même au-delà du handler
 * global ci-dessus, seul le compteur non lu doit suivre. */
export function subscribeToForegroundNotifications(onReceived: (data: PushData) => void): () => void {
  const subscription = Notifications.addNotificationReceivedListener((event) => {
    const data = (event.request.content.data ?? {}) as PushData;
    if (alreadySeen(data.eventId)) return;
    onReceived(data);
  });
  return () => subscription.remove();
}

/** Appui sur la notification, application en arrière-plan OU relancée
 * depuis fermée (`getLastNotificationResponseAsync` couvre ce second cas —
 * l'écouteur seul ne voit pas toujours la réponse qui a rouvert l'app,
 * selon le moment où il est posé). */
export function subscribeToNotificationTaps(onOpen: (data: PushData) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = (response.notification.request.content.data ?? {}) as PushData;
    if (alreadySeen(data.eventId)) return;
    onOpen(data);
  });

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (!response) return;
    const data = (response.notification.request.content.data ?? {}) as PushData;
    if (alreadySeen(data.eventId)) return;
    onOpen(data);
  });

  return () => subscription.remove();
}
