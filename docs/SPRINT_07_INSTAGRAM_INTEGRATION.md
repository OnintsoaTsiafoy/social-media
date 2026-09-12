# Sprint 07 — Intégration Instagram

Cette livraison applique la tranche Sprint 07 du plan
(`sprint_listing/SPRINT_07_INSTAGRAM_INTEGRATION.md`) : ajouter Instagram en
réutilisant les contrats posés au Sprint 05 (`/internal/v1`) et au Sprint 06
(comptes/tokens/OAuth), sans dupliquer `graph-api`.

**Décision produit** : les deux parcours OAuth Meta sont supportés — compte
Instagram lié à une Page Facebook (`FACEBOOK_PAGE`, découvert automatiquement
lors d'un `connect('facebook')`, Sprint 06) et connexion Instagram directe
sans Page (`INSTAGRAM_LOGIN`, Instagram Login).

## Indirection provider

`modules/social/provider.py` définit un `Protocol` (`publish`, `get_comments`,
`reply_to_comment`, `get_insights`) et un registre `get_provider(name)`.
`modules/facebook/provider.py` enveloppe les services Facebook déjà durcis au
Sprint 05 (client par compte, voir plus bas) ; `modules/instagram/provider.py`
est la nouvelle implémentation Instagram. `internal_service.py` dispatche sur
ce registre après résolution du compte — les 4 routes `/internal/v1`
(`publish`, `comments/sync`, `comments/reply`, `metrics/sync`) restent
inchangées côté contrat, seul le provider résolu change selon
`social_accounts.provider`.

## Publication Instagram

Modèle par conteneur, pas d'appel direct comme Facebook :

1. `POST /{ig-user-id}/media` (créer le conteneur avec `image_url` + `caption`).
2. `GET /{container-id}?fields=status_code` en boucle jusqu'à `FINISHED`
   (`IN_PROGRESS` → poll, `ERROR`/`EXPIRED` → échec), intervalle et nombre
   d'essais configurables (`INSTAGRAM_CONTAINER_POLL_INTERVAL_SECONDS`,
   `..._MAX_ATTEMPTS`).
3. `POST /{ig-user-id}/media_publish` avec `creation_id`.

Une seule image par publication ce sprint (pas de carrousel — hors
périmètre, cohérent avec le composeur mobile qui n'attache qu'un média).
`services/worker/src/social-http-provider.js` est le seul point qui appelle
réellement `graph-api` pour livrer une publication (`index.js` bascule du
mock au vrai provider via `SOCIAL_PROVIDER_MODE`, cf. Vérification).

## Commentaires

`modules/instagram/services` répond via l'edge `/replies` (pas `/comments`
comme Facebook — différence d'API confirmée, pas supposée). Sync/reply
fonctionnent pour les deux providers via la même route `/internal/v1`. Pas de
persistance (`social_comments`/`comment_analyses` appartient au Sprint 08 par
`docs/MATRICE_ENDPOINT_SPRINT.md`) : la réponse est calculée à la volée contre
Meta (mocké dans les tests).

## Métriques

`null` strict pour toute métrique indisponible (jamais `0`, cohérent avec la
convention mobile déjà en place). Pas de table `social_metrics` ce sprint
(Sprint 12) : normalisation bout-en-bout côté `graph-api` uniquement.

## `PARTIALLY_PUBLISHED` multi-réseaux

`computePublicationStatus` (`services/shared/publication-status.js`) était
déjà agnostique du provider — vérifié, pas modifié. Confirmé manuellement
(voir Vérification) : une publication Facebook+Instagram où un seul réseau
échoue calcule bien `partially_published`.

## Client par compte (Facebook)

`FacebookClient.__init__` accepte désormais `page_id`/`access_token`
optionnels : `internal_service.py` résout le compte
(`social_accounts`/`oauth_tokens`) et instancie un client dédié à cette
requête plutôt que de lire la configuration globale `.env`. Quand
`socialAccountId` est absent (anciennes requêtes, ou provider sans compte
connecté), `_publish_legacy_global()` retombe sur le comportement Sprint 05
(token global unique) — chemin conservé pour compatibilité ascendante, testé
séparément (`test_internal_routes.py` vs `test_internal_routes_per_account.py`).

## Rafraîchissement du token Instagram Login (correctif)

Écart détecté en relisant `account_service.py` après l'avoir écrit : le
rafraîchissement d'un compte `INSTAGRAM_LOGIN` renvoyait un `422` (« non
implémenté ») au lieu de tourner le token. Un token Instagram Login expire
réellement (~60 jours, contrairement au token de Page qui ne l'expire pas
activement) — laissé tel quel, le cron quotidien du worker
(`refresh-expiring-oauth-tokens`, Sprint 06) aurait échoué silencieusement
sur chaque compte Instagram Login sans jamais le repasser en
`REAUTH_REQUIRED`, laissant l'écran mobile afficher « connecté » après
l'expiration réelle du token.

Corrigé : `oauth_instagram.refresh_long_lived_token(token)` appelle
`GET https://graph.instagram.com/v25.0/refresh_access_token?grant_type=ig_refresh_token`
(même hôte/version que l'échange initial `ig_exchange_token`, déjà vérifié
pendant la planification — à reconfirmer en direct avant mise en production,
comme le reste de ce module) ; `account_service.refresh_token()` route
désormais vers cette rotation réelle pour `INSTAGRAM_LOGIN` et vers la
revalidation existante pour `FACEBOOK_PAGE`. Un rejet Meta (token expiré/trop
récent) marque le compte `REAUTH_REQUIRED` et répond `409
REAUTHENTICATION_REQUIRED`, symétrique au chemin Facebook.

## Tests

`graph-api` : 128 tests (respx, aucun appel Meta réel), dont
`test_internal_routes_per_account.py`, `test_instagram_oauth_callback.py`,
les deux cas de rotation `INSTAGRAM_LOGIN` et les quatre cas de
`GET .../profile` (route Sprint 06 manquante, ajoutée ici — voir
`docs/SPRINT_06_OAUTH_MULTI_COMPTES_TOKENS.md`) dans
`test_social_account_routes.py`. `services/api` : 38 tests (inchangés ce
sprint). `services/worker` : 23 tests, dont `social-http-provider.test.js`
(adaptateur `deliver()` réel). Mobile : `tsc --noEmit` et `expo lint` verts —
aucun changement nécessaire (`ComposerForm.tsx`, badges et tokens de thème
Instagram existaient déjà depuis les sprints précédents).

## Scénario de vérification manuelle exécuté

1. `docker compose up --build`, sonde des 6 services (`verify-readiness.ps1`) : OK.
2. `PATCH /api/v1/publications/:id` avec un payload `targets` (ajout, retrait,
   modification) contre la pile réelle : les trois cas passent (régression du
   Sprint 06 Jour 1 détectée et corrigée avant celle-ci, voir plus bas).
3. Publication Facebook en mode `SOCIAL_PROVIDER_MODE=live` avec des
   identifiants Meta volontairement invalides (aucun compte réel disponible
   dans cet environnement) : Meta rejette réellement la requête (`400`,
   `OAuthException`) ; `graph-api` traduit en `validation_failed` sans fuite
   de token dans les logs ; le worker marque la cible `FAILED` (non
   retryable) ; la publication passe `failed`. Aucun crash à aucune couche —
   confirme le durcissement du Sprint 05 face à un vrai rejet Meta, pas
   seulement mocké.
4. Publication Facebook+Instagram en mode `mock` avec le marqueur
   `[[FAIL_INSTAGRAM]]` : `facebook` → `sent`, `instagram` → `failed`,
   publication → `partially_published`. Confirme `computePublicationStatus`
   avec le nouveau dispatch par provider.
5. `SOCIAL_PROVIDER_MODE` remis à `mock` (aucun compte Meta réel connecté
   dans cet environnement local — voir `.env.example`).

## Régression corrigée avant cette vérification

`services/api/src/publications/service.js::updatePublication` référençait
encore l'ancien index composé `publicationId_provider` dans un
`prisma.publicationTarget.upsert(...)`, supprimé au Sprint 06 Jour 1 au
profit de `publicationId_socialAccountId` (pour autoriser deux comptes du
même réseau sur une publication). Aurait fait échouer tout
`PATCH /publications/:id` incluant `targets` avec une erreur Prisma. Remplacé
par une résolution manuelle (`findFirst` puis `update`/`create`) qui ne
dépend plus d'une contrainte unique sur `(publicationId, provider)` ; `data`
récupère aussi désormais `socialAccountId` via le `targetData` devenu
asynchrone (résolution automatique du compte, Sprint 06). Détecté en
relecture avant tout test manuel, jamais poussé en l'état — corrigé et vérifié
(section précédente, point 2) avant de considérer les Sprints 05–07 terminés.

## Décisions Meta non vérifiées (à confirmer avant mise en production)

- Hôte/route exacts de `refresh_access_token` pour Instagram Login
  (`graph.instagram.com/v25.0/refresh_access_token`, par symétrie avec
  l'échange initial déjà vérifié) — jamais appelé contre une vraie App Meta.
- Contraintes exactes de taille/format d'image pour `media_publish` (le code
  ne valide aujourd'hui que ce que Meta rejette lui-même).
- En-têtes exacts de rate-limit Meta (`X-Business-Use-Case-Usage`) — non
  exploités, seul le `429`/`Retry-After` générique du Sprint 05 s'applique.
- Permissions exactement nécessaires pour répondre à un commentaire Instagram
  en conditions réelles (`instagram_business_manage_comments` demandé, jamais
  confirmé contre l'App Review de ce projet).

## Hors périmètre (rappel, cf. plan)

Webhooks Meta, persistance/modération des commentaires (Sprint 08),
`/api/v1/analytics/*` (Sprint 12), soumission App Review réelle, écran
« sélecteur de Pages » (toutes les Pages/comptes IG éligibles sont liés
automatiquement, l'utilisateur retire ceux qu'il ne veut pas).
