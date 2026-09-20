# Console d'administration web — état livré

La console `admin-web/` (Vite, React, TypeScript) est branchée sur l'API Express : **plus aucun jeu de données fictif**. Elle est en **français par défaut** et gère l'anglais par un système d'internationalisation maison. Ce document décrit l'API d'administration qu'elle consomme, la définition exacte de chaque chiffre affiché, et ce qui n'existe volontairement pas.

## 1. Sécurité

- **Rôle plateforme.** `users.platform_role` (`USER` par défaut, `PLATFORM_ADMIN`) — migration `20260920000000_platform_admin`. Il est indépendant des rôles par marque (`BrandMemberRole`) et **ne donne aucun accès implicite** aux routes par marque : celles-ci exigent toujours une appartenance à la marque.
- **Contrôle d'accès.** Toutes les routes `/api/v1/admin/*` passent par `requireAuthentication` (jeton + relecture de la session à chaque requête) puis `requirePlatformAdmin`. Le rôle est relu en base à chaque appel : le retirer, ou suspendre le compte, coupe l'accès **immédiatement**, sans attendre l'expiration du jeton d'accès. Un compte non administrateur reçoit `403 forbidden` (l'existence de l'API d'admin n'est pas un secret, contrairement à celle d'une marque, qui reste un `404`).
- **Jetons côté web.** Le jeton d'accès (15 min) ne vit qu'en mémoire ; le jeton de rafraîchissement est dans `sessionStorage` (survit à un rechargement, pas à la fermeture de l'onglet). L'API n'offre pas de cookie `httpOnly`. Le rafraîchissement est à usage unique côté serveur : un seul est en vol à la fois côté client.
- **CORS.** Désactivé par défaut. En développement, le proxy de Vite (`/api` → API) rend la console et l'API « même origine ». Si la console est servie ailleurs : `VITE_API_BASE_URL` côté web et `CORS_ALLOWED_ORIGINS` (liste blanche, jamais `*`) côté API.
- **Garde-fous.** Un administrateur ne peut ni se suspendre ni retirer son propre rôle ; le rôle du propriétaire d'une marque n'est pas modifiable ici (aucun transfert de propriété n'existe) ; toute action d'administration écrit une ligne dans `audit_logs`, avec les noms copiés dans les métadonnées (le journal reste lisible si une marque est renommée).
- **Compte de démonstration.** `./scripts/seed.ps1` crée `admin@hootly.app` / `ChangeMe123!` (administrateur de la plateforme) et une liste de mots-clés de modération. À remplacer avant tout environnement partagé.

## 2. API `/api/v1/admin`

Conventions communes : enveloppe `{ data, meta }` ; erreurs `{ error: { code, message, requestId } }` ; `network=all|facebook|instagram` ; `period=7d|30d|90d` ; listes `{ items, page, pageSize, total }`. Code : [services/api/src/admin/](../services/api/src/admin/) (`routes.js` mince, `schemas.js` Zod, un fichier de service par écran).

| Route | Rôle |
|---|---|
| `GET /session` | Profil et rôle de la session (403 si non administrateur) |
| `GET /summary` | Compteurs de la coque : pages, comptes, en ligne, brouillons à relire, escalades, SLA, autonomie IA |
| `GET /overview` | KPI, volume, sentiment, santé, escalades ouvertes, classement (`period`, `network`) |
| `GET /live` | Commentaires de la dernière heure et flux récent (`network`) |
| `GET /supervision` | File des brouillons IA, circuit de validation, performance du modèle, réglages |
| `POST /supervision/drafts/{id}/approve` | Approuve (texte retouché facultatif) **puis envoie** la réponse |
| `POST /supervision/drafts/{id}/reject` | Rejette avec un motif : `wrong_tone`, `incorrect_facts`, `policy_risk`, `too_generic` |
| `POST /supervision/drafts/{id}/escalate` | Escalade le commentaire (statut `ESCALATED`) |
| `POST /escalations/{commentId}/resolve` | Clôt une escalade (statut `PROCESSED`) |
| `GET /analytics/trend` | Courbe + période précédente (`metric`, `period`, `sentiment`, `pageId`, `network`) |
| `GET /analytics/pages` | Performance par page, activité par heure, pages filtrables |
| `GET /users` · `PATCH /users/{id}` | Comptes ; suspension, rôle plateforme, rôles par marque (une transaction, un audit par changement) |
| `GET /pages` · `PATCH /pages/{id}` | Pages connectées (avec le compte qui les a liées) ; réponse automatique par page |
| `POST /pages/connect` | Démarre la liaison d'un compte utilisateur (`userId`, `brandId`) à une page Facebook : `201 { authorizationUrl, expiresAt }` (voir §6) |
| `GET /pages/connect/selections/{id}` · `POST …/link` | Au retour de Facebook : pages proposées (sans jeton) ; lie **uniquement** les pages choisies (`pageIds`) |
| `GET /settings` · `POST/DELETE /settings/keywords` · `PATCH /settings/service-levels` · `PATCH /settings/supervision` | Configuration |
| `GET /audit` | Journal d'audit de l'administration |

Approuver, rejeter, escalader et clore **réutilisent les services du mobile** (`approveSuggestion`, `rejectSuggestion`, `replyToComment`, `setCommentStatus`) : une seule implémentation de l'approbation humaine, de l'envoi exactement-une-fois et de l'audit. Seul le contrôle d'appartenance à la marque est remplacé par le rôle plateforme.

## 3. Définition de chaque chiffre

Une mesure qu'on ne peut pas calculer vaut `null` et s'affiche **« Non disponible »**, jamais `0`. Aucune tendance n'est fabriquée sans période de référence comparable (la période précédente a la même durée et se termine où la courante commence).

| Indicateur | Définition (source) |
|---|---|
| Commentaires analysés | `social_comments` créés dans la période **ayant une analyse** (`latest_analysis_id`) |
| 1re réponse (médiane) | Médiane de `sent_responses.finished_at − COALESCE(meta_created_at, created_at)` pour les réponses `SUCCEEDED` (uniquement les réponses envoyées par Hootly) |
| Résolus par l'IA | Part des réponses envoyées dont la proposition `SENT` est encore `generated_by_ai` (envoyée **sans retouche humaine**) |
| Escalades ouvertes | Commentaires `ESCALATED` ; « de plus de 2 h » d'après la dernière transition vers `ESCALATED` dans `comment_status_history` ; écart = escalades ouvertes dans la période − période précédente |
| Gravité d'une escalade | `critical` si l'analyse est urgente, `high` si priorité `HIGH`, sinon `medium` (sans analyse : `medium`) |
| SLA (barre du haut) | Part des réponses des 30 derniers jours envoyées dans le délai cible (réglage « première réponse ») |
| Comptes en ligne | Utilisateurs actifs avec une session non révoquée créée/rafraîchie dans les 20 dernières minutes |
| Jauge « commentaires / h » | Commentaires reçus dans la dernière heure |
| Santé du système | Webhooks en échec et latence moyenne (24 h, `webhook_events`), arriéré de modération (`NEW`), pages dont le jeton expire sous 7 jours. Les seuils de couleur sont côté web (`domain/overview.ts`) |
| Taux d'engagement | Formule unique de l'analytique mobile (`aggregateSnapshots`) : (réactions + commentaires + partages) / portée, sur les publications parues dans le seau |
| Sentiment | Part du sentiment choisi (« tous » = positifs) parmi les commentaires analysés |
| Performance par page | Commentaires reçus, délai médian, part IA, score de sentiment (part de positifs, en points) par compte social |
| Pic d'activité | Commentaires par heure (fuseau de l'administrateur), moyenne journalière sur la période |
| Performance du modèle | `ai_feedback` sur 30 jours : approuvés / modifiés / rejetés (un brouillon régénéré compte comme rejeté) ; durée moyenne de génération |
| Effet du seuil d'autonomie | Calculé sur la **distribution réelle** des `confidence_score` des brouillons IA des 30 derniers jours |

La courbe d'analytique compte 7 points sur 7 jours, 10 sur 30 et 90 jours. Le filtre de sentiment ne s'applique pas à l'engagement (calculé à partir des publications) : il est désactivé sur cet onglet.

## 4. Réglages : enregistrés, pas (tous) appliqués

`platform_settings` (une ligne par clé, verrou de ligne à l'écriture : deux administrateurs ne s'écrasent pas). Valeurs par défaut dans le code tant qu'aucune ligne n'existe.

| Clé | Contenu | Consommé aujourd'hui ? |
|---|---|---|
| `service_levels` | Délais (première réponse, escalade, mode nuit), en minutes | **Oui** pour le SLA affiché ; les autres sont enregistrés |
| `moderation.keywords` | Mots-clés de modération | **Non** — la liste n'alimente pas encore l'analyse des commentaires |
| `ai.supervision` | Envoi automatique, seuil d'autonomie, règles d'escalade | **Non** — rien ne part sans une proposition approuvée par un humain (garde-fou central du Sprint 10) ; l'écran le dit explicitement |
| `pages.auto_reply` | Réponse automatique par page (seules les pages activées sont stockées) | **Non** |

Brancher l'envoi automatique serait un changement de comportement produit (des réponses publiques sans relecture) : il n'a pas été fait ici.

## 5. Ce qui n'existe volontairement pas

Ces éléments de la maquette n'ont aucun équivalent côté serveur ; les garder aurait affiché de fausses actions :

- **Statut « Invité » et bouton « Inviter un manager »** : aucun mécanisme d'invitation n'existe (les statuts serveur sont `ACTIVE` / `DISABLED`).
- **Interrupteurs de permissions par membre** : les droits découlent du rôle par marque ; le tiroir édite donc le **rôle par marque** et l'accès plateforme.
- **Statut « Limité par l'API »** et **quota Graph API** : le serveur ne stocke aucune donnée de quota.
- **Flux « en direct » simulé, statuts IA tournants, « managers en ligne 41/58 »** : remplacés par des mesures réelles (sondage toutes les 10 s pour le flux, 30 à 60 s pour le reste).
- **Rétention du journal « 180 jours »** : aucune purge n'est implémentée, l'étiquette a été retirée.

## 6. Connecter une page à un compte utilisateur

Depuis l'écran **Pages**, « Connecter une page Facebook » permet à un administrateur de la plateforme de lier une page à **un compte utilisateur et à l'une de ses marques**. Le parcours mobile (`POST /social-accounts/facebook/connect`, où l'utilisateur lie ses propres pages) est **inchangé** : les deux coexistent et écrivent en base par le même code (`graph-api/modules/oauth/page_linking.py`).

Trois temps :

1. **Choix.** L'administrateur cherche un compte actif et une marque dont ce compte est propriétaire ou administrateur (même règle que le mobile, `requireBrandAccess('ADMIN')`). `POST /pages/connect { userId, brandId }` répond `201 { authorizationUrl, expiresAt }` et la console redirige le navigateur vers Facebook. Le `state` OAuth reste côté serveur.
2. **Consentement Meta.** L'administrateur s'authentifie **avec son propre compte Facebook**. graph-api reçoit le retour, échange le code, lit `/me/accounts` (et le compte Instagram professionnel de chaque page) et **ne lie rien** : il enregistre la liste, jetons de page compris mais chiffrés, dans `oauth_page_selections`, puis renvoie le navigateur vers `ADMIN_WEB_URL/#/pages?status=select&selection=<uuid>`. Un échec revient en `?status=error&reason=permission_denied|incompatible_account|provider_error` (bandeau sur l'écran Pages).
3. **Sélection.** `GET /pages/connect/selections/{id}` renvoie les pages **sans aucun jeton**, chacune marquée `alreadyLinked` (reconnexion : le jeton est renouvelé) ou `linkedElsewhere` (liée à une autre marque). `POST …/link { pageIds }` ne lie que les pages choisies, avec leur compte Instagram. La console nettoie l'adresse (`history.replaceState`) : recharger la page ne rouvre pas la sélection.

**Pourquoi une sélection obligatoire.** Le compte Facebook de l'administrateur gère souvent les pages de plusieurs clients ; tout lier d'office, comme le mobile le fait pour l'utilisateur, rattacherait des pages à la mauvaise marque.

| Garantie | Mise en œuvre |
|---|---|
| Pas de redirection ouverte | L'adresse de retour est calculée par le serveur depuis `ADMIN_WEB_URL` (origine seule, `http`/`https`, plus `/#/pages`) ; le client n'envoie que `userId` et `brandId`. Valeur invalide : `503 provider_unavailable` |
| Jetons de page jamais côté Express ni web | Chiffrés (AES-256-GCM, clé de graph-api) dans `oauth_page_selections.encrypted_payload` ; Express ne reçoit que la liste sans jeton |
| Sélection à usage unique, 15 minutes | `UPDATE … WHERE consumed_at IS NULL AND expires_at > now()` **avant** toute écriture ; un second `link` répond `404` |
| Seul l'initiateur la termine | `initiated_by_user_id` comparé à l'administrateur connecté, sinon `404` (l'existence d'une sélection n'est pas divulguée) |
| Une page appartient à une seule marque | Une page déjà liée à une **autre** marque est refusée (`409 conflict`, détails `pageId`, `name`, `brandName`) au lieu d'être déplacée, ce qui emporterait ses commentaires et publications : il faut d'abord la déconnecter de l'autre marque |
| Rien d'imprévu n'est lié | `pageIds` doit être inclus dans les pages proposées, sinon `422` sans consommer la sélection |
| Rôle revérifié au retour | Le compte doit encore être membre actif, propriétaire ou administrateur de la marque au moment de lier |
| Traçabilité | `social_accounts.connected_by_user_id` = le compte utilisateur ; l'administrateur est dans `oauth_states.initiated_by_user_id` et dans `audit_logs` (`admin.page.connect_started`, puis `admin.page.connected` pour chaque compte lié) |

**Configuration.** Mêmes prérequis Meta que le mobile (`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, URI de callback de graph-api déclarée dans l'application Meta), plus `ADMIN_WEB_URL` côté API (défaut `http://localhost:5173`) : l'adresse publique de la console, à renseigner dès qu'elle n'est pas servie sur ce port. La migration `20260920010000_admin_page_connection` ajoute `oauth_states.select_pages` / `initiated_by_user_id` et la table `oauth_page_selections`. Il faut reconstruire les images **api** et **graph-api** (`./scripts/start.ps1`).

## 7. Internationalisation

Code : [admin-web/src/i18n/](../admin-web/src/i18n/). Aucune dépendance.

- **Langue principale : français** (`DEFAULT_LOCALE`). Choix mémorisé dans `localStorage` (`pulse.locale`), sélecteur FR / EN dans la barre du haut et sur l'écran de connexion, `<html lang>` mis à jour.
- **Catalogues typés.** `fr.ts` est la référence ; `en.ts` est typé `Record<keyof typeof fr, string>` : une clé manquante ou en trop est une **erreur de compilation**. Un test vérifie en plus que les deux langues utilisent les mêmes paramètres et les mêmes formes plurielles.
- **Pluriels** : `x_one` / `x_other`, `t("x", { count })`, règle `Intl.PluralRules` de la langue (en français, 0 et 1 sont singuliers).
- **Typographie française** appliquée à l'affichage : espace insécable avant `: ; ? ! %` et dans les guillemets « ».
- **Formats** (`format.int`, `duration`, `percent`, `longDate`, `relative`…) suivent la langue : `12 480` / `12,480`, `3 min 08 s` / `3m 08s`, `68,4 %` / `68.4%`.
- **Erreurs** : le code stable de l'API (`conflict`, `forbidden`…) sert de clé de traduction, jamais le texte du serveur (comme `toUserMessage()` sur mobile). Le journal d'audit reçoit l'action et des métadonnées structurées et est mis en phrase côté web, dans la langue courante.
- **Ajouter une langue** : ajouter le code à `LOCALES` et au `INTL_TAG` de `format.ts`, créer `xx.ts` typé comme `en.ts`, l'enregistrer dans `CATALOGS` (`index.tsx`). L'application mobile n'a pas d'i18n : elle reste en français.

## 8. Lancer et tester

```powershell
./scripts/start.ps1 ; ./scripts/seed.ps1      # API + base + compte administrateur
npm --prefix admin-web install                 # une fois
npm --prefix admin-web run dev                 # http://localhost:5173 (proxy /api → localhost:3000)
```

| Niveau | Commande |
|---|---|
| Unitaires API (schémas, gravité, CORS, jetons…) | `npm --prefix services/api test` |
| Intégration API sur base réelle | `ADMIN_INTEGRATION=1 node --test test/admin.integration.test.js` depuis un conteneur du réseau Compose (`docker run --network hootly_default --env-file .env --entrypoint sh hootly-api …`, code copié dans `/app/services/api`) — il ne touche que ses lignes et restaure `platform_settings` ; un second test y joue la liaison d'une page contre un faux graph-api HTTP (démarrage, sélection, refus d'une page d'une autre marque, liaison, usage unique) |
| Unitaires graph-api (sélection, liaison, single-use) | `python -m pytest tests/test_oauth_page_selection.py` depuis `graph-api/` (venv) |
| Web : unitaires + écrans (API simulée) | `npm --prefix admin-web test`, `typecheck`, `lint` |
| Web ↔ API réelle | `ADMIN_E2E=1 VITE_API_BASE_URL=http://localhost:3000/api/v1 npm --prefix admin-web test -- e2e` (écritures réversibles) |

La migration s'applique au démarrage du conteneur `api` (`prisma migrate deploy`) : reconstruire l'image (`./scripts/start.ps1`) pour disposer des routes d'administration.
