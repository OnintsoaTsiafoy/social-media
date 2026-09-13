# Sprint 11 — Firebase Cloud Messaging et notifications

Cette livraison applique la tranche Sprint 11 du plan
(`sprint_listing/SPRINT_11_FIREBASE_NOTIFICATIONS.md`) : un historique de
notifications persistant en base, des tokens d'appareil FCM gérés par
utilisateur, un service unique d'envoi Firebase côté Express, quatre
producteurs d'événements (analyse de commentaire, réponse IA générée,
publication, compte social), et le client mobile qui les reçoit au premier
plan, en arrière-plan et application fermée.

**La règle qui structure tout le sprint : Firebase n'est jamais la source de
vérité.** REST et la base le restent — une notification est toujours
persistée et committée avant tout appel à Firebase, et un échec FCM ne fait
jamais disparaître l'historique. `contracts/socket-events.yaml` (le plan
Socket.IO du Sprint 01) est remplacé par ce mécanisme ; il ne reste que comme
référence de vocabulaire, pas comme transport.

## Modèle et REST (Jour 1)

Migration `20260913020000_notifications_device_tokens`.

| Table | Rôle |
|---|---|
| `notifications` | Une ligne **par destinataire**, jamais un événement partagé : un commentaire signalé sur une marque à trois community managers crée trois lignes. Unicité sur `(event_id, user_id)`, pas sur `event_id` seul — c'est ce qui permet à la fois le fan-out et la déduplication par destinataire. |
| `device_tokens` | Un token FCM par ligne, unique globalement. Un appareil réinstallé ou reconnecté sous un autre compte réassigne la ligne au nouvel utilisateur plutôt que d'en laisser une orpheline. `disabledAt` marque un token invalide détecté par Firebase, sans perdre l'historique de l'appareil. |
| `notification_settings` | Une ligne par utilisateur, créée à la demande (upsert au premier réglage), pas à l'inscription. |

`NotificationType` reprend **exactement** le vocabulaire déjà câblé côté
mobile (`social-media/src/types/index.ts::NotificationType`, présent depuis
le Sprint 01) : minuscules sur le fil, majuscules en base, aucune table de
correspondance. Conséquence assumée : il n'existe **pas** de type générique
« commentaire reçu ». Seuls les commentaires que l'analyse qualifie
(prioritaire, négatif, urgent) déclenchent une notification — un commentaire
neutre n'en produit aucune, pour ne pas alerter à chaque réception.

| Route Express | Rôle |
|---|---|
| `GET /api/v1/notifications` | Paginée, filtre `all\|unread\|priority\|errors` (même sémantique que `notificationsApi.list()` côté mobile). Portée par `userId` seul — l'appartenance à la marque a déjà été vérifiée une fois, à la création. |
| `GET /api/v1/notifications/unread-count` | Utilisé par `GET /auth/me` (voir Jour 5) et le badge d'onglet. |
| `PATCH /api/v1/notifications/{id}/read` | Idempotent : relire une notification déjà lue ne change pas son horodatage. 404 (jamais 403) sur une notification d'un autre utilisateur. |
| `POST /api/v1/notifications/read-all` | |
| `POST /api/v1/device-tokens` | Upsert par `token`. |
| `DELETE /api/v1/device-tokens` | Le token voyage dans le corps, pas l'URL. Silencieux si déjà absent. |
| `GET/PATCH /api/v1/notification-settings` | Valeurs par défaut si l'utilisateur n'a encore rien réglé (même idiome que `profile/service.js::preferencesOf`). |

`href` (route mobile à ouvrir) est calculé **côté serveur**
(`notifications/service.js::hrefFor`) à partir de `resourceType`/`resourceId`,
jamais transmis tel quel par un producteur — le client n'a pas à connaître la
table de routage.

## Firebase Cloud Messaging (Jour 2)

`services/api/src/lib/firebase.js` charge les credentials **uniquement**
depuis trois variables d'environnement (`FIREBASE_PROJECT_ID`,
`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — les trois champs utiles
d'une clé de compte de service téléchargée depuis la console Firebase).
Aucune credential Firebase n'est committée : `.env`/`.env.example`
documentent où trouver chaque valeur et l'échappement `\n` nécessaire pour la
clé privée sur une ligne. Tant qu'elles sont absentes, l'API démarre et reste
`/ready` normalement — Firebase est un canal annexe, jamais un bloquant.

`NotificationPushService` (`notifications/push.js`) est le **seul** point du
code qui appelle `firebase-admin` :

- Payload **data-only** (`{version, eventId, type, notificationId,
  resourceType, resourceId, brandId}`, toutes les valeurs en chaîne, aucun
  bloc `notification`) — c'est ce qui laisse le client décider entièrement de
  l'affichage et de la déduplication, y compris au premier plan.
- Priorité FCM/APNs dérivée de la priorité de la notification.
- Envoi multicast à tous les appareils actifs du **seul** destinataire.
- Seuls deux codes FCM (`registration-token-not-registered`,
  `invalid-registration-token`) désactivent un token ; tout le reste (quota,
  panne serveur) est transitoire et ne touche pas à l'appareil.
- Ne lève **jamais** : un problème Firebase est journalisé, jamais remonté à
  l'appelant — la notification déjà persistée reste intacte.

## Producteurs d'événements (Jour 3)

Nouveau point d'entrée `POST /internal/v1/notifications`
(`lib/serviceAuth.js`, audience `api-service`, scope `notifications:write`) :
Firebase Admin ne vit que dans Express, donc le worker — qui détecte la
plupart des événements en SQL direct — lui délègue la création et l'envoi. Un
appel par destinataire (`services/worker/src/notifications-client.js`), sur
le modèle déjà établi de `social-account-client.js`.

`createNotification()` (`notifications/service.js`) est le point d'entrée
unique, appelé aussi bien en direct par Express que par cette route interne :
il **persiste toujours** la notification (idempotent par `(eventId, userId)`
via la contrainte unique — un `P2002` est un rejeu sans effet, pas une
erreur), puis ne pousse que si les préférences de l'utilisateur l'autorisent
— type activé, priorité au-dessus du plancher réglé, et hors plage
silencieuse (une notification `HIGH` traverse toujours la plage silencieuse,
qui est un confort, pas une raison de manquer un signal urgent).

| Événement | Déclencheur | Destinataires |
|---|---|---|
| Analyse de commentaire (prioritaire / négatif / urgent) | `comments/service.js::analyzeComment` (à la demande) et `comment-analysis.js` (balayage automatique du worker) | Tous les membres `COMMUNITY_MANAGER+` de la marque ; l'acteur exclu si l'analyse est manuelle (il voit déjà le résultat), personne exclu si automatique |
| Réponse IA générée | `response-suggestions/service.js::createSuggestion`, seulement si `generatedByAi` | Les **autres** community managers de la marque — pas celui qui vient de générer |
| Publication (publiée / échouée / partielle) | `delivery.js`, après recalcul du statut agrégé | L'auteur de la publication |
| Compte social (expire bientôt / expiré / déconnecté) | `token-refresh.js`, sur une vraie dégradation de statut (jamais un statut inchangé) | La personne qui a connecté le compte |

`eventId` porte la traçabilité de chaque producteur :
`comment-analysis:{analysisId}:{type}`, `response-suggestion:{suggestionId}`,
`publication:{id}:{status}`, `social-account:{id}:{newStatus}`.

## Client mobile (Jour 4)

Aucun écran recréé. `notificationsApi` (`src/data/api.ts`) passe des
fixtures à `fetchApi` ; `app/notifications.tsx` et
`app/settings/notifications.tsx` sont inchangés (seule la copie « temps réel
par WebSocket », jamais construite, est corrigée).

`src/lib/pushNotifications.ts` centralise Firebase côté client :
autorisation système, token FCM natif
(`Notifications.getDevicePushTokenAsync()`), enregistrement/renouvellement,
et trois écouteurs (réception au premier plan, appui sur la notification,
dernière réponse connue au lancement — ce dernier couvre le cas application
fermée). `PushNotificationsBridge` (`app/_layout.tsx`) les active dès que la
session est `signedIn`, jamais avant. Déduplication par `eventId` en mémoire
(fenêtre bornée à 200 entrées) : un second envoi du même événement
(plusieurs appareils, rejeu réseau côté FCM) est ignoré silencieusement.

`quietHoursStart`/`quietHoursEnd` utilisent déjà `''` côté écran de réglages
(convention antérieure à ce sprint) alors que le serveur utilise `null` :
la conversion vit dans `notificationsApi`, à la frontière, plutôt que de
changer l'écran ou le contrat serveur pour l'autre convention.

Le badge natif de l'icône (`Notifications.setBadgeCountAsync`) suit
`unreadCount` de `SessionProvider`, jamais un simple compteur incrémental —
sinon il dérive dès qu'une notification est lue ailleurs.

## Reprise et tests (Jour 5)

`GET /api/v1/auth/me` renvoyait un `unreadCount` **codé en dur à 0** depuis
sa création (Sprint 02, avant que `notifications` n'existe) — corrigé pour
lire le vrai compteur. C'est le chemin par lequel l'écran de démarrage
(`SessionProvider::restore`) rattrape les notifications manquées après une
absence, et `AppState` déclenche le même rattrapage à chaque retour au
premier plan — jamais seulement le push, qui peut avoir été manqué
(application fermée sans réveil possible pour un message *data-only*,
appareil hors ligne).

Tests automatisés : **105** (`services/api`, +23), **45** (`services/worker`,
+20). Mobile : `tsc --noEmit` et `expo lint` verts (pas de `npm test` pour ce
paquet — convention du dépôt, voir CLAUDE.md).

### Scénario de vérification manuelle

1. `docker compose up --build` : `/health` et `/ready` de l'API restent verts
   sans aucune credential Firebase configurée.
2. Connexion, `POST /api/v1/device-tokens` avec un token de test : `201`,
   upsert confirmé par un second appel avec le même token.
3. Insertion directe d'une notification (aucun producteur ne passe encore par
   un vrai commentaire/publication dans cette vérification) ou appel de
   `POST /internal/v1/notifications` avec un JWT de service minté par le
   worker : `GET /api/v1/notifications` la montre, `PATCH .../read` puis
   `POST /read-all` la marquent lue.
4. Rejouer le même `eventId` : `{"deduplicated": true}`, aucune seconde ligne.
5. Second utilisateur : `GET /api/v1/notifications` ne montre jamais les
   notifications du premier ; tenter `PATCH .../read` sur l'une d'elles
   renvoie `404`, jamais `403`.
6. Une fois `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`
   renseignées et un appareil Android réel connecté (`npx expo prebuild
   --platform android --clean` requis, voir limites) : déclencher une
   analyse de commentaire négatif/urgent et confirmer la réception au
   premier plan, en arrière-plan, puis application fermée.

## Décisions et limites

- **« Commentaire reçu » n'a pas de producteur dédié.** Repris dans
  prioritaire/négatif/urgent uniquement (voir Jour 1) — un commentaire neutre
  ne notifie personne.
- **`SYNC_FAILED` reste un type inerte.** Aucun producteur ne l'émet : la
  valeur d'un déclencheur fiable sur les échecs de synchronisation de secours
  paraissait trop faible face au risque de spam (le balayage tourne toutes
  les 15 minutes).
- **Portée mobile réelle : Android uniquement.** `expo-notifications` renvoie
  sur Android le vrai token FCM que `NotificationPushService` peut adresser
  directement. Sur iOS, le même appel renvoie un jeton APNs brut, inutilisable
  tel quel par Firebase Admin sans le pont natif (Firebase iOS SDK) — et
  aucun projet `ios/` n'a jamais été prébuildé dans ce dépôt.
  `registerForPushNotifications()` sort tôt sur toute plateforme autre
  qu'Android.
- **Limite d'arrière-plan la plus importante à connaître** : un message FCM
  *data-only* ne réveille **pas** une application Android complètement tuée
  (contrairement à un message avec bloc `notification`, affiché directement
  par l'OS). Tant que le processus est vivant (premier plan ou arrière-plan),
  les écouteurs reçoivent l'événement ; une fois l'application fermée, seul un
  appui sur une notification déjà affichée par le système — ce qui n'arrive
  jamais pour un message data-only — ou, plus réalistement, l'ouverture
  manuelle de l'application, ramène l'utilisateur à jour via `GET /auth/me` /
  `GET /api/v1/notifications`. C'est un choix délibéré du sprint (« le client
  recharge les données critiques depuis l'API »), pas un bug caché : mais cela
  signifie concrètement qu'un utilisateur qui a fermé l'application ne verra
  **aucune** alerte tant qu'il ne la rouvre pas lui-même.
- **`sound`/`vibration` ne sont pas câblés.** Les deux bascules existent dans
  `notification_settings` et l'écran de réglages, mais rien ne les applique
  encore — ni côté serveur (un message data-only n'a pas de son/vibration à
  configurer côté FCM), ni côté client (le canal Android `default` utilise le
  son système). Les appliquer demanderait au client de lire ces préférences
  avant d'afficher lui-même l'alerte reçue.
- **Aucune icône de notification dédiée.** Le plugin `expo-notifications` est
  déclaré sans `icon`/`color` : Android utilise l'icône de l'application par
  défaut.
- **`npx expo prebuild --platform android --clean` est nécessaire** avant tout
  build natif réel : `android/` est ignoré par Git (généré par Expo) et ne
  reflète pas encore le plugin `expo-notifications` ni `googleServicesFile`
  tant qu'il n'a pas été régénéré depuis `app.json`.
- **Aucun envoi FCM réel n'a été vérifié bout en bout** : les credentials
  Firebase et un appareil Android réel restent à fournir pour la démonstration
  finale (voir le scénario de vérification, étape 6).
