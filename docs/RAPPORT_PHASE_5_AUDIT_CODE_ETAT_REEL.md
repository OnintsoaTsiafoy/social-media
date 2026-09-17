# Phase 5 — Audit du code et état réel

Date de l'audit : 16 septembre 2026  
Périmètre : dépôt `D:\MBDS\stage\social-media`  
Méthode : lecture statique de l'intégralité des sources pertinentes, recherche d'usages, comparaison frontend/backend, lecture des scripts et contrats, exécution non destructive des tests, inspection des conteneurs, ports et journaux disponibles.

> Ce document est le seul fichier créé pour cette phase. Aucun fichier applicatif, test, configuration ou donnée n'a été modifié.

## 1. Résumé exécutif

Le dépôt forme une application cohérente et largement implémentée : application Expo, API Express/Prisma, worker pg-boss, passerelle Meta FastAPI, service IA FastAPI, PostgreSQL/pgvector et MinIO. Les chemins principaux disposent d'une quantité importante de tests automatisés. Les exécutions réalisées pendant cet audit totalisent **664 tests réussis et 5 tests ignorés**, en comptant le fichier de tests worker oublié par le lanceur officiel.

L'état réel n'est cependant pas « tout est opérationnel » :

- aucun service Hootly n'est actuellement en cours d'exécution ; aucun des ports 3000, 3001, 5432, 8000, 8080, 8081, 9000 ou 9001 n'écoute ;
- tous les conteneurs Compose existent mais sont arrêtés ; `ai-service` porte un dernier code de sortie 137 ;
- les images arrêtées sont en retard sur le dépôt : l'API arrêtée connaissait 12 migrations contre 13 dans le code, et le worker arrêté déclarait 8 files contre 11 dans le code courant ;
- Firebase n'était pas configuré lors des dernières exécutions visibles, donc les notifications REST existaient mais le push était un no-op ;
- les intégrations réelles Meta, Firebase, Anthropic, appareil Android/iOS et import natif ne sont pas démontrées par les suites courantes ;
- le script global `scripts/test.ps1` peut finir avec succès malgré des étapes en échec et n'exécute ni les tests mobiles ni le test worker des concurrents ;
- plusieurs fonctionnalités visibles restent incomplètes : réception du lien de réinitialisation, avatar, rappel avant publication, sélection de média depuis les fichiers et push iOS ;
- un défaut de mapping confirmé peut empêcher la sauvegarde correcte de la consigne d'urgence d'une marque ;
- plusieurs façades frontend et alias backend sont présents mais sans appel réel depuis un écran ;
- la documentation historique et certains commentaires décrivent encore des fixtures qui ont depuis été remplacées par de vrais appels HTTP.

## 2. État dynamique observé

### 2.1 Processus, ports et conteneurs

| Élément | Preuve observée | État au moment de l'audit |
|---|---|---|
| API Express | `docker compose ps --all`, port 3000 fermé | conteneur arrêté, dernier arrêt propre `Exited (0)` |
| Worker | idem, port 3001 fermé | conteneur arrêté, dernier arrêt propre `Exited (0)` |
| graph-api | idem, port 8000 fermé | conteneur arrêté, dernier arrêt propre `Exited (0)` |
| ai-service | idem, port 8080 fermé | conteneur arrêté, `Exited (137)` ; les dernières lignes montrent néanmoins un shutdown Uvicorn ordonné |
| PostgreSQL | port 5432 fermé | conteneur arrêté ; dernier journal : fast shutdown puis base arrêtée proprement |
| MinIO | ports 9000/9001 fermés | conteneur arrêté ; dernier journal : signal `TERMINATED` |
| Expo/Metro | port 8081 fermé, aucun processus Node pertinent | non lancé |
| Healthchecks | `verify-readiness.ps1` ne joint pas `localhost:3000` | non exécutables tant que la pile est arrêtée |

Les processus Java visibles appartiennent à Android Studio et aux extensions VS Code ; ils ne prouvent pas l'exécution de Hootly.

### 2.2 Ce que prouvent les journaux récents

- L'API a déjà démarré et appliqué les migrations disponibles dans son image.
- Le worker a déjà exécuté ses balayages de commentaires, analyses, métriques et nettoyage.
- graph-api et ai-service ont déjà répondu `200` à leurs sondes `/health`.
- L'API a journalisé `firebase_not_configured` : la persistance de notification fonctionnait, pas la livraison FCM.
- Une exécution de l'API a utilisé le repli analytics local (`analytics-local-v1`, statut `fallback`).
- Un journal API contient un échec d'initialisation du stockage média. Il n'est pas horodaté assez précisément dans la sortie pour affirmer que ce défaut est encore actif.
- Le conteneur API avait trouvé **12 migrations**, alors que le dépôt en contient maintenant **13**.
- Le worker exécuté annonçait seulement 8 files, sans `sync-competitor`, `sync-competitor-posts` et `sync-competitor-metrics`, alors que le code courant en enregistre 11.

Conclusion dynamique : les sources actuelles sont plus récentes que les dernières images exécutées. `scripts/start.ps1` utilise `compose up --build`, donc un redémarrage par ce script devrait reconstruire les images ; il faut néanmoins le vérifier avant toute démonstration.

## 3. Recherche transversale

### 3.1 TODO, FIXME et code commenté

- Aucun `FIXME` actif significatif n'a été trouvé dans les sources applicatives.
- Les occurrences de `TODO` font presque toutes référence au nom d'un cahier des charges (`TODO_ANALYSE_CONCURRENTIELLE...`, `TODO_RECOMMANDATION_MEILLEUR_HORAIRE...`). Elles documentent l'origine d'une règle ; elles ne représentent pas, à elles seules, du travail restant.
- Aucun bloc important d'ancienne implémentation JavaScript/TypeScript/Python commentée n'a été trouvé.
- `graph-api/legacy/*.java` est une ancienne implémentation complète, conservée explicitement comme archive et non compilée.

### 3.2 Mocks, doubles et données temporaires

| Élément | Nature | Usage réel |
|---|---|---|
| `services/shared/social-provider.js` | fournisseur social simulé | activable en exécution par `SOCIAL_PROVIDER_MODE=mock` ; le défaut documenté est `live` |
| `services/worker/test/fake-db.js` | double mémoire de PostgreSQL | tests worker uniquement |
| `graph-api/tests/conftest.py` | repositories et stores mémoire | tests graph-api ; empêche la plupart des tests d'atteindre PostgreSQL |
| mocks `fetch`, respx et services IA/Meta | doubles réseau | tests API, worker, graph-api et intégrations isolées |
| `services/ai-service/evaluation/fixtures.json` | jeu d'évaluation | évaluation hors production |
| `services/ai-service/dataset/comments.v1.jsonl` | dataset local | entraînement réel du modèle local pendant le build |
| `services/api/prisma/seed.js` | données de démonstration | uniquement via `scripts/seed.ps1` |
| `services/api/prisma/repair-demo-data.js` | réparation ponctuelle de démo | script manuel, hors démarrage normal |
| médias `TEMPORARY` | données métier temporaires | mécanisme réel ; nettoyage horaire après 24 h par le worker |

Les mocks de test ne sont pas du code de production. Le fournisseur social simulé est, lui, un chemin de production explicitement sélectionnable pour démo/staging.

### 3.3 Dépendances

Les dépendances directes Node importantes ont toutes un usage identifiable dans l'API et le worker. Côté mobile, aucune importation directe n'a été trouvée pour `expo-asset`, `expo-file-system` et `expo-system-ui`. Elles peuvent toutefois être requises transitivement ou nativement par Expo : leur suppression ne doit pas être décidée sans `expo doctor`, build natif et test web.

`react-dom`, `react-native-web`, `react-native-screens` et `react-native-worklets` ont également peu ou pas d'importations applicatives directes, mais sont des dépendances d'intégration/peer normales d'Expo Router, React Native Web ou Reanimated. Elles ne sont donc pas classées comme inutiles confirmées.

Les fichiers Python `requirements.txt` épinglent aussi des dépendances transitives. Cela améliore la reproductibilité immédiate mais augmente le coût de mise à jour et le risque de divergence d'un verrou généré.

## 4. Inventaire des fichiers significatifs

Les fichiers générés, caches, lockfiles, images de validation et migrations individuelles ne sont pas documentés un par un. Les familles homogènes sont regroupées lorsque leurs responsabilités sont identiques.

### 4.1 Racine, déploiement et contrats

#### `compose.yaml`

Rôle : décrit PostgreSQL/pgvector, MinIO, API, worker, graph-api et ai-service.  
Appelé par : `scripts/start.ps1`, `stop.ps1`, `logs.ps1`, `seed.ps1` et les scripts d'intégration.  
Dépend de : `.env`, Docker/Podman, Dockerfiles.  
Éléments importants : ports publiés, volumes persistants, variables, dépendances, healthchecks.  
Fonctionnalités : déploiement local complet.  
État : complet pour le développement, mais healthchecks fondés sur `/health` plutôt que `/ready`; tous les conteneurs sont actuellement arrêtés.

#### `.env.example`, `social-media/.env.example`, `graph-api/.env.example`

Rôle : catalogue des variables et valeurs de développement.  
Appelé par : Compose, Expo et Pydantic Settings.  
Dépend de : secrets fournis localement.  
Éléments importants : JWT, chiffrement Meta, S3, Firebase, Meta, Anthropic, URLs.  
Fonctionnalités : configuration de tous les services.  
État : riche mais risqué si copié tel quel hors local ; plusieurs secrets de développement et une clé de chiffrement d'exemple sont fixes. L'environnement local courant est en retard sur l'exemple pour au moins les deux variables IA signalées par Compose.

#### `scripts/start.ps1`, `stop.ps1`, `logs.ps1`, `seed.ps1`, `ContainerRuntime.ps1`

Rôle : cycle de vie Compose/Podman.  
Appelé par : développeur.  
Dépend de : `.env`, moteur actif.  
Fonctions importantes : `Get-ComposeCommand`, `Invoke-Compose`.  
Fonctionnalités : build, lancement, arrêt conservant les volumes, logs, seed.  
État : cohérent ; `start.ps1` reconstruit les images, ce qui est requis vu leur dérive actuelle.

#### `scripts/verify-readiness.ps1`

Rôle : interroge huit sondes HTTP.  
Appelé par : développeur/documentation.  
Dépend de : pile démarrée et ports locaux publiés.  
Fonction importante : `Assert-Status`.  
Fonctionnalités : validation de disponibilité.  
État : fonctionnel d'après le code ; échec actuel attendu car la pile est arrêtée.

#### `scripts/test.ps1`

Rôle : prétend exécuter la suite complète.  
Appelé par : développeur et README.  
Dépend de : pytest local, installations npm.  
Fonctionnalités : tests Python/Node, typecheck, lint.  
État : **défectueux** comme orchestrateur : ne contrôle pas `$LASTEXITCODE`, continue après échec, omet `npm --prefix social-media run test` et les intégrations conditionnelles.

#### `scripts/test-*-integration.mjs`

Rôle : exécute les intégrations analytics, approbations et concurrents contre PostgreSQL Compose avec services externes simulés.  
Appelé par : manuellement seulement.  
Dépend de : image API, base Compose et variables de garde.  
Fonctionnalités : contraintes DB, concurrence, files.  
État : présents mais non inclus dans `test.ps1`; non exécutés pendant cet audit car la pile persistante était arrêtée.

#### `contracts/openapi/*.yaml`, `contracts/*.json`, `contracts/*.md`

Rôle : contrats publics/internes, Postman, WebSocket et RAG.  
Appelé par : documentation et tests manuels ; pas généré depuis les routeurs.  
Dépend de : synchronisation manuelle avec le code.  
Fonctionnalités : consommation et validation contractuelle.  
État : utile mais divergent par endroits ; le contrat YAML public et l'OpenAPI construit dans `server.js` ne décrivent pas exactement la même surface.

### 4.2 Application Expo

#### `social-media/app/_layout.tsx`, `app/index.tsx`, groupes `(auth)` et `(tabs)`

Rôle : racine Expo Router, providers, redirections d'authentification, notifications et navigation principale.  
Appelé par : `expo-router/entry`.  
Dépend de : `SessionProvider`, `ComposerProvider`, `FeedbackProvider`, Expo Notifications.  
Fonctions importantes : gestion des taps push et redirection signed-in/signed-out.  
Fonctionnalités : démarrage, session, navigation.  
État : connecté ; typecheck/lint réussis, pas de test E2E global.

#### `social-media/src/data/api.ts`

Rôle : client HTTP, refresh JWT, mappings DTO, upload multipart et toutes les façades métier.  
Appelé par : presque tous les écrans et stores.  
Dépend de : `secureStorage`, `fetch`, types frontend.  
Classes/fonctions importantes : `ApiError`, `fetchApi`, `refreshAccessToken`, `auth`, `profile`, `brandsApi`, `accountsApi`, `publicationsApi`, `commentsApi`, `knowledgeApi`, `notificationsApi`, `analyticsApi`, `competitorsApi`.  
Fonctionnalités : totalité des communications frontend/backend.  
État : réellement connecté mais monolithique (plus de 1 500 lignes), avec commentaire d'en-tête obsolète, façades inutilisées et un défaut confirmé de mapping marque.

#### `social-media/src/store/SessionProvider.tsx`

Rôle : restaure et expose session, utilisateur, marque active et compteur non lu.  
Appelé par : layouts et écrans protégés.  
Dépend de : API auth/marques/notifications, SecureStore, push.  
Fonctions importantes : restore, sign-in/out, setters de contexte.  
Fonctionnalités : authentification persistante et contexte global.  
État : connecté ; les erreurs de chargement secondaires de marque/compteur sont volontairement absorbées.

#### `social-media/src/store/ComposerProvider.tsx`

Rôle : brouillon local partagé entre composition, hashtags et média.  
Appelé par : écrans publication et composants de composition.  
Dépend de : types métier React.  
Fonctions importantes : patch/reset du brouillon.  
Fonctionnalités : création/modification de publication.  
État : utilisé.

#### `social-media/src/hooks/useAsync.ts`, `usePaginatedList.ts`

Rôle : état asynchrone, mutation, rechargement et pagination.  
Appelé par : presque tous les écrans.  
Dépend de : React.  
Fonctions importantes : `useAsync`, `useMutation`, `usePaginatedList`.  
Fonctionnalités : chargement/erreur/rafraîchissement.  
État : utilisé ; couverture indirecte seulement.

#### `social-media/src/lib/secureStorage.ts`

Rôle : stockage des access/refresh tokens dans SecureStore natif ou sessionStorage web.  
Appelé par : client API et SessionProvider.  
Dépend de : Expo SecureStore et plateforme.  
Fonctionnalités : persistance de session.  
État : utilisé ; le stockage web reste exposé à un éventuel XSS.

#### `social-media/src/lib/pushNotifications.ts`

Rôle : permissions, token FCM Android, handlers, déduplication et routage.  
Appelé par : layout/session.  
Dépend de : Expo Device/Notifications et API device tokens.  
Fonctions importantes : `registerForPushNotifications`, `subscribeToTokenRefresh`, `subscribeToForegroundNotifications`, `subscribeToNotificationTaps`, `hrefFor`.  
Fonctionnalités : push Android.  
État : connecté par le code, non opérationnel dans le dernier environnement (Firebase absent), iOS explicitement non implémenté.

#### `social-media/src/lib/format.ts`, `validation.ts`, `data/options.ts`

Rôle : formatage, règles client et listes de choix.  
Appelé par : écrans et composants.  
Dépend de : API Intl et types.  
Fonctionnalités : cohérence d'affichage et validation UX.  
État : largement utilisés ; la validation serveur reste la source d'autorité.

#### `social-media/src/components/ui/*`

Rôle : design system, états, formulaires, graphiques, feedback et accessibilité.  
Appelé par : tous les écrans et composants de domaine.  
Dépend de : React Native, Reanimated, thème.  
Éléments importants : `Screen`, `Button`, `TextField`, `BottomSheet`, `LoadingState`, `ErrorState`, graphiques.  
Fonctionnalités : interface transversale.  
État : utilisé, sauf exports potentiellement morts `SkeletonCard` et `dismissKeyboard`. `Feedback.tsx` comportait déjà une modification utilisateur non liée à cet audit.

#### `social-media/src/components/domain/*`

Rôle : cartes de publications/commentaires/concurrents, calendrier, approbation, analytics et composeur.  
Appelé par : écrans.  
Dépend de : UI, API, types.  
Éléments importants : `ComposerForm`, `PublicationApprovalPanel`, `AnalyticsInsightPanel`, `RecommendedTimes`.  
Fonctionnalités : domaines principaux.  
État : utilisé ; seul l'export `TAB_BAR_HEIGHT` n'a aucun usage trouvé.

#### `social-media/app/(auth)/*.tsx`

Rôle : inscription, connexion, oubli et reset.  
Appelé par : navigation publique.  
Dépend de : `auth`, session, validation.  
Fonctionnalités : identité.  
État : connecté ; l'oubli de mot de passe ne peut pas aboutir sans fournisseur d'e-mail backend.

#### `social-media/app/(tabs)/home.tsx`

Rôle : dashboard, raccourcis, comptes, commentaires, publications et analytics.  
Appelé par : tab principale.  
Dépend de : cinq façades API.  
Fonctionnalités : synthèse.  
État : connecté ; la carte « Démo des états » appelle une simulation qui n'influence aucune requête.

#### `social-media/app/(tabs)/publications.tsx`, `publications/**/*.tsx`, `calendar.tsx`, `media-picker.tsx`, `hashtags.tsx`

Rôle : cycle de publication, approbation, planification, calendrier, média et hashtags.  
Appelé par : tabs et navigation détaillée.  
Dépend de : publications, médias, comptes sociaux, approbations, worker indirect.  
Fonctionnalités : publication sociale.  
État : majoritairement connecté ; rappel non transmis, sélection « Fichiers » non implémentée, suppression directe d'un média non appelée.

#### `social-media/app/(tabs)/comments.tsx`, `comments/[id]/*.tsx`

Rôle : liste, détail, analyse, historique, génération/validation/envoi de réponse.  
Appelé par : tab, dashboard et notifications.  
Dépend de : commentaires, suggestions IA, paramètres de marque.  
Fonctionnalités : modération et assistance IA.  
État : connecté et partiellement testé par `response-editor.test.cjs`; appels Meta réels non testés.

#### `social-media/app/(tabs)/analytics.tsx`, `analytics/**/*.tsx`, `competitors/**/*.tsx`

Rôle : synthèses, détails, insights, horaires, concurrents et comparaison.  
Appelé par : tab analytics et navigation.  
Dépend de : analytics/competitors API, IA indirecte.  
Fonctionnalités : reporting.  
État : connecté ; quelques wrappers sont inutilisés, la suite mobile cible surtout les concurrents/insights et non tous les écrans.

#### `social-media/app/settings/*.tsx`, `profile.tsx`, `knowledge/**/*.tsx`, `notifications.tsx`, `ai-feedback.tsx`

Rôle : compte, sécurité, marque/IA, comptes sociaux, préférences, RAG et notifications.  
Appelé par : tab paramètres, liens push/OAuth.  
Dépend de : API transversales.  
Fonctionnalités : administration utilisateur/marque.  
État : connecté ; avatar non implémenté, changement de marque existante absent, push conditionnel, import natif RAG non validé manuellement.

### 4.3 API Express

#### `services/api/src/server.js`

Rôle : composition Express, health/readiness, OpenAPI manuel, montage des routeurs et arrêt propre.  
Appelé par : `npm start`, tests health.  
Dépend de : tous les modules API, storage, jobs.  
Fonctions importantes : `app`, `start`.  
Fonctionnalités : point d'entrée public.  
État : démarrable ; OpenAPI maintenu à la main et routeur de suggestions monté deux fois.

#### `services/api/src/auth/{routes,schemas,service,tokens,middleware}.js`

Rôle : contrôleurs, DTO Zod, sessions, JWT, refresh, reset et garde utilisateur.  
Appelé par : `server.js`, frontend, autres middlewares.  
Dépend de : Prisma, bcrypt, jsonwebtoken, audit.  
Fonctions importantes : `register`, `login`, `refresh`, `requireAuthentication`, `createAccessToken`.  
Fonctionnalités : authentification complète sauf transport du lien de reset.  
État : bien testé en unitaire ; flux e-mail incomplet.

#### `services/api/src/profile/*`, `brands/*`

Rôle : profil, préférences, marques, rôles et paramètres IA.  
Appelé par : frontend et middlewares des autres domaines.  
Dépend de : Prisma, auth, audit.  
Fonctions importantes : `requireBrandAccess`, `activeBrandForUser`, `updateAiSettings`.  
Fonctionnalités : identité métier et autorisations.  
État : implémenté ; une partie des endpoints et la bascule de marque sont sans UI.

#### `services/api/src/media/*`, `lib/storage.js`, `services/shared/media-inspect.js`

Rôle : upload, détection réelle du type, URL signée, rattachement et suppression.  
Appelé par : mobile, publications, worker.  
Dépend de : Multer, S3/MinIO, Prisma.  
Fonctions importantes : inspection binaire, clés temporaires/définitives, `ensureBucket`.  
Fonctionnalités : médias de publication/avatar.  
État : publication connectée ; avatar et suppression proactive non raccordés au mobile.

#### `services/api/src/publications/*`, `approvals/*`, `services/shared/publication-status.js`

Rôle : CRUD, transitions, planification, idempotence et approbations.  
Appelé par : mobile et worker via DB/jobs.  
Dépend de : Prisma, pg-boss, médias, audit.  
Fonctions importantes : création/mise à jour, scheduling, `changeApproval`, règles de statut.  
Fonctionnalités : workflow éditorial.  
État : fortement testé ; intégration DB conditionnelle non exécutée dans la suite normale.

#### `services/api/src/social-accounts/*`, `lib/socialServiceClient.js`, `lib/serviceJwt.js`

Rôle : façade OAuth/comptes sociaux et client graph-api authentifié.  
Appelé par : mobile et domaines sync.  
Dépend de : graph-api, Prisma pour contrôle d'accès, JWT interservice.  
Fonctions importantes : connect/status/sync/disconnect, traduction d'erreurs.  
Fonctionnalités : Meta OAuth et comptes.  
État : testé avec réseau simulé ; Meta réel non vérifié.

#### `services/api/src/comments/*`, `response-suggestions/*`, `ai-feedback/*`

Rôle : commentaires, analyses, suggestions, sécurité, feedback humain et envoi.  
Appelé par : mobile, worker, IA, graph-api.  
Dépend de : Prisma, ai-service, graph-api, notifications, RAG.  
Fonctions importantes : `analyzeComment`, `replyToComment`, `createSuggestion`, `approveSuggestion`, `recordFeedback`.  
Fonctionnalités : modération assistée.  
État : implémenté et bien testé hors services externes réels ; surface dupliquée `/response-suggestions` et `/ai/responses`.

#### `services/api/src/knowledge/*`, `lib/aiServiceClient.js`

Rôle : documents, extraction/indexation, embeddings, recherche vectorielle et appel IA.  
Appelé par : mobile et suggestions RAG.  
Dépend de : Prisma/pgvector et ai-service.  
Fonctions importantes : CRUD versionné, `vectorLiteral`, seuil de similarité.  
Fonctionnalités : base de connaissances/RAG.  
État : implémenté ; intégration DB et vrai modèle d'embedding hors test standard.

#### `services/api/src/notifications/*`, `lib/firebase.js`

Rôle : centre de notifications, préférences, tokens appareil et push FCM.  
Appelé par : mobile, API et worker via route interne.  
Dépend de : Prisma, Firebase Admin, service JWT.  
Fonctions importantes : `notifyUser`, `pushNotification`, filtres quiet-hours/priorité.  
Fonctionnalités : notification persistante et push.  
État : persistance opérationnelle d'après code/tests ; Firebase non configuré dans le dernier runtime.

#### `services/api/src/analytics/*`, `dashboard/*`, `competitors/*`

Rôle : agrégats, faits, anomalies, insights IA, meilleurs horaires, dashboard et analyse concurrentielle.  
Appelé par : mobile et worker.  
Dépend de : Prisma, ai-service, pg-boss, métriques partagées.  
Fonctions importantes : `analyticsSummary`, `generateAnalyticsInsight`, `computeBestTimes`, `competitorAnalytics`, `competitorsComparison`.  
Fonctionnalités : reporting.  
État : très couvert en logique pure ; image worker déployée en retard sur les jobs concurrents.

#### `services/api/src/lib/{http,audit,idempotency,jobs,serviceAuth,socialMetrics}.js`

Rôle : enveloppes HTTP, erreurs, audit, idempotence, jobs, JWT entrant et métriques.  
Appelé par : tous les domaines.  
Dépend de : Express, Prisma/pg-boss, JWT.  
Fonctionnalités : infrastructure transverse.  
État : utilisé ; aucune couche repository Express, les services accèdent directement à Prisma.

### 4.4 Worker

#### `services/worker/index.js`

Rôle : point d'entrée, création/enregistrement des 11 files, cron, health/readiness et arrêt.  
Appelé par : `npm start`.  
Dépend de : pg-boss, modules worker, services partagés.  
Fonctions importantes : `startJobs`, handlers de queues.  
Fonctionnalités : exécution asynchrone.  
État : code courant complet ; dernière image exécutée limitée à 8 files.

#### `services/worker/src/delivery.js`

Rôle : livraison multi-réseaux idempotente, retries, statuts et notifications.  
Appelé par : trois queues de publication.  
Dépend de : DB, stockage, fournisseur social.  
Fonctionnalités : publication réelle.  
État : 20 scénarios environ dans la suite standard ; Meta réel non appelé.

#### `cleanup-media.js`, `token-refresh.js`, `comment-sync.js`, `comment-analysis.js`, `metrics-sync.js`

Rôle : tâches périodiques de maintenance, OAuth, commentaires, IA et statistiques.  
Appelé par : cron/queues de `index.js`.  
Dépend de : DB et clients externes.  
Fonctionnalités : automatisation de fond.  
État : utilisés et couverts par doubles ; pas de test bout en bout actuel.

#### `competitor-sync.js`, `competitor-client.js`

Rôle : profil/posts/métriques concurrents en trois étapes.  
Appelé par : trois queues concurrentielles.  
Dépend de : DB, graph-api et notifications.  
Fonctionnalités : analyse concurrentielle.  
État : code et 14 tests présents ; ces tests sont oubliés par `test/run.js`, et les queues manquent dans la dernière image exécutée.

#### `social-http-provider.js`, `social-account-client.js`, `ai-client.js`, `notifications-client.js`

Rôle : clients HTTP interservices signés.  
Appelé par : tâches worker.  
Dépend de : `SERVICE_JWT_SECRET`, URLs de services, `fetch`.  
Fonctionnalités : Meta, analyse IA, notifications internes.  
État : testés avec doubles réseau ; pas de circuit breaker centralisé.

#### `db.js`, `storage.js`, `src/lib/serviceJwt.js`

Rôle : accès PostgreSQL brut, S3 et jetons de service.  
Appelé par : tous les jobs.  
Dépend de : `pg`, AWS SDK et JWT.  
Fonctionnalités : infrastructure worker.  
État : utilisé ; SQL manuel couplé au schéma Prisma.

### 4.5 graph-api

#### `graph-api/main.py`, `core/{config,middleware,exceptions,security,rate_limit,crypto}.py`

Rôle : composition FastAPI, configuration, erreurs, request-id, rate limit, JWT et chiffrement.  
Appelé par : Uvicorn et tous les routeurs.  
Dépend de : FastAPI/Pydantic, SlowAPI, PyJWT, cryptography.  
Fonctionnalités : socle de la passerelle Meta.  
État : implémenté ; duplication importante avec le socle ai-service.

#### `api/routes/facebook_routes.py`

Rôle : ancienne API Facebook directe.  
Appelé par : `main.py`; aucun appel Hootly interne actuel trouvé.  
Dépend de : services Facebook utilisant les credentials globaux.  
Fonctionnalités : posts, commentaires, analytics, stories.  
État : accessible mais non protégée ; vulnérabilité confirmée de Phase 4 et code mort opérationnel potentiel.

#### `api/routes/internal_routes.py`, `social_account_routes.py`

Rôle : publication/sync/insights interservices et gestion de comptes.  
Appelé par : API/worker avec JWT de service.  
Dépend de : providers, repositories, crypto.  
Fonctionnalités : chemin Meta réellement utilisé.  
État : connecté et testé avec Meta/DB simulés.

#### `api/routes/oauth_routes.py`, `webhook_routes.py`

Rôle : OAuth Facebook/Instagram et webhooks Meta.  
Appelé par : navigateur Meta et plateforme Meta.  
Dépend de : services OAuth/webhooks et repositories.  
Fonctionnalités : connexion et ingestion temps réel.  
État : implémenté ; redirection mobile trop permissive déjà confirmée en Phase 4, environnement Meta réel non validé.

#### `modules/facebook/**/*`, `modules/instagram/*`, `modules/oauth/*`, `modules/webhooks/*`

Rôle : clients, schémas et logique par fournisseur.  
Appelé par : routeurs et providers sociaux.  
Dépend de : HTTPX, Meta Graph API, repositories.  
Fonctionnalités : Facebook, Instagram, OAuth, webhook.  
État : utilisé et largement testé avec respx ; appels réels non démontrés.

#### `modules/competitors/*`

Rôle : vérification et collecte des concurrents selon les capacités Meta.  
Appelé par : routes internes appelées par API/worker.  
Dépend de : providers Facebook/Instagram.  
Fonctionnalités : analyse concurrentielle.  
État : code actuel complet ; non présent dans le worker déployé observé.

#### `db/*_repository.py`, `db/pool.py`

Rôle : SQL brut pour OAuth, comptes, permissions, idempotence, commentaires et métriques.  
Appelé par : services graph-api.  
Dépend de : psycopg et schéma migré par Prisma.  
Fonctionnalités : persistance sociale.  
État : utilisé ; les tests unitaires remplacent majoritairement ces repositories par des fakes.

#### `graph-api/legacy/*.java`

Rôle : archive de l'ancienne implémentation servlet.  
Appelé par : rien dans le build ou le runtime.  
Dépend de : ancien environnement Java absent.  
Fonctionnalités : historique seulement.  
État : code mort intentionnel clairement documenté.

### 4.6 ai-service

#### `services/ai-service/main.py`, `core/*`

Rôle : composition FastAPI, configuration, sécurité, erreurs, rate limit.  
Appelé par : Uvicorn.  
Dépend de : FastAPI/Pydantic, JWT, SlowAPI.  
Fonctionnalités : socle IA.  
État : implémenté et testé ; duplication avec graph-api.

#### `api/routes/internal_routes.py`, `assistance_routes.py`, `knowledge_routes.py`, `analytics_routes.py`

Rôle : analyse de commentaire, modèles, génération, sécurité, hashtags, extraction/embedding et explications.  
Appelé par : API/worker via JWT de service.  
Dépend de : modules NLP/génération/RAG/analytics.  
Fonctionnalités : toutes les capacités IA.  
État : connecté ; les routes non-health sont internes, mais certaines routes d'assistance/knowledge ne correspondent pas toutes à un appel de production direct.

#### `modules/nlp/*`, `training/*`, `dataset/comments.v1.jsonl`

Rôle : prétraitement, règles, modèles scikit-learn, entraînement et évaluation.  
Appelé par : build Docker et route d'analyse.  
Dépend de : scikit-learn/joblib.  
Fonctionnalités : sentiment, intention, priorité.  
État : réel, non stub ; modèles entraînés au build. Dataset local limité et à surveiller.

#### `modules/generation/*`, `modules/workflow/*`, `modules/safety/*`

Rôle : génération locale/Anthropic, LangGraph et contrôles de sécurité.  
Appelé par : assistance et suggestions.  
Dépend de : paramètres marque, documents, Anthropic optionnel.  
Fonctionnalités : réponses et hashtags.  
État : mode local opérationnel d'après tests ; Anthropic non configuré dans l'environnement observé.

#### `modules/knowledge/pipeline.py`, `warmup.py`

Rôle : extraction PDF/DOCX/TXT/CSV, chunking et fastembed.  
Appelé par : routes knowledge et Docker/diagnostic.  
Dépend de : fastembed, pypdf, python-docx.  
Fonctionnalités : RAG.  
État : code testé, mais test d'embedding réel ignoré faute de modèle téléchargé explicitement.

#### `modules/analytics/*`

Rôle : explications de faits analytics, meilleurs horaires et concurrents sans invention de chiffres.  
Appelé par : routes analytics.  
Dépend de : générateur local ou Anthropic.  
Fonctionnalités : narration analytics.  
État : fortement testé, repli local observé dans les logs.

#### `evaluation/*`

Rôle : comparaison local/LLM, calibration et rapport humain.  
Appelé par : commandes manuelles, pas par le serveur.  
Dépend de : fixtures et éventuellement Anthropic.  
Fonctionnalités : qualité modèle.  
État : outillage valide mais résultats versionnés potentiellement datés par rapport au modèle courant.

## 5. Tests : état réel

### 5.1 Exécutions réalisées pendant l'audit

| Suite | Résultat | Ce qu'elle prouve | Limites |
|---|---:|---|---|
| API Node | 168 réussis, 4 ignorés | schémas, tokens, logique métier, clients, sérialisation, analytics | quatre intégrations PostgreSQL conditionnelles non exécutées |
| Worker, lanceur officiel | 53 réussis | livraison, cleanup, tokens, commentaires, IA, métriques | fakes DB/réseau ; oublie les concurrents |
| Worker concurrents, lancé directement | 14 réussis | trois étapes concurrent, cas partiels, métriques | absent de `test/run.js` |
| graph-api | 184 réussis | routes, OAuth, Meta simulé, webhooks, résilience | repositories majoritairement fakes ; nécessite environnement neutralisé |
| ai-service | 228 réussis, 1 ignoré | NLP, workflow, génération, sécurité, analytics, RAG | embedding réel ignoré, Anthropic simulé/absent |
| Mobile | 17 réussis | éditeur de réponse, approbation, insights et concurrents | très faible couverture par rapport au nombre d'écrans |
| TypeScript mobile | réussi | cohérence statique | ne prouve pas le runtime natif |
| Expo ESLint | réussi | règles lint mobile | aucun lint équivalent API/worker/Python dans le script global |

Total explicite : **664 réussites, 5 skips, 0 échec applicatif après isolation correcte**.

La première exécution de `scripts/test.ps1` a échoué pour deux raisons environnementales : `pytest` absent du Python hôte et création de sous-processus Node interdite dans le bac à sable. Le script a pourtant continué jusqu'au lint et a rendu un succès final. Après exécution adaptée :

- l'API passe hors restriction de spawn ;
- les suites Python passent dans les images existantes avec le code courant monté en lecture seule ;
- graph-api échoue 2 fois si les secrets Compose contaminent le processus de test, puis passe 184/184 lorsque ces variables sont neutralisées.

Cette sensibilité graph-api est elle-même une dette de test : deux tests supposent des variables absentes, tandis que des singletons lisent l'environnement à l'import.

### 5.2 Tests automatiques réellement inclus par la commande officielle

`scripts/test.ps1` appelle :

1. pytest graph-api ;
2. pytest ai-service ;
3. tests API ;
4. tests worker via son lanceur ;
5. typecheck mobile ;
6. lint mobile.

Il **n'appelle pas** :

- `npm --prefix social-media run test` ;
- `services/worker/test/competitor-sync.test.js` ;
- les scripts d'intégration analytics, approbation et concurrents ;
- le smoke test RAG live ;
- un build/export Expo ;
- un test Android/iOS/web automatisé ;
- une mesure de couverture.

### 5.3 Tests manuels documentés

Preuves trouvées :

- `docs/VALIDATION_SPRINT_01.md` décrit une procédure, mais pas un journal daté d'exécution complet ;
- `docs/RAG_FEEDBACK_HUMAIN.md` rapporte un parcours Android rejoué et fournit `docs/validation/rag-editor-approved.png` ;
- `docs/ANALYTICS_INSIGHTS.md` fournit `docs/validation/analytics-insights-mobile.png` ;
- le document RAG indique explicitement que l'import par sélecteur natif reste à tester ;
- la documentation Firebase indique qu'un vrai appareil Android et des credentials réels restent nécessaires, et que le chemin iOS n'est pas implémenté.

Une capture prouve un écran/scénario précis, pas l'ensemble du parcours ni les intégrations externes.

### 5.4 Domaines non prouvés automatiquement

- OAuth Meta réel et App Review ;
- publication/réponse réellement envoyée à Facebook ou Instagram ;
- signature et réception de webhooks réels ;
- FCM réel sur appareil Android, application en arrière-plan/tuée ;
- push iOS ;
- Anthropic réel et gestion de quota/coût ;
- accès MinIO depuis un appareil physique avec URL LAN ;
- migrations sur une base de production contenant des données ;
- reprise après crash réel du worker ;
- performance/charge, gros médias, gros documents et très grands volumes ;
- compatibilité web complète ;
- accessibilité sur lecteur d'écran réel ;
- sécurité dynamique et tests d'intrusion.

## 6. Problèmes confirmés

### C-01 — Le script global peut masquer les échecs

Preuve : `scripts/test.ps1` utilise `$ErrorActionPreference = 'Stop'`, mais les exécutables externes qui rendent un code non nul ne déclenchent pas automatiquement une exception PowerShell. Pendant l'audit, deux pytest et 25 fichiers API ont échoué, puis le script a continué et a terminé avec le code du lint réussi.

Impact : CI ou développeur peut considérer à tort la suite verte.

### C-02 — La commande « complète » omet des tests

Preuve : absence du script mobile et des intégrations dans `test.ps1`; `services/worker/test/run.js` n'importe pas `competitor-sync.test.js`.

Impact : 31 tests réellement présents (17 mobile + 14 worker concurrent) ne participent pas au verdict officiel, sans compter les quatre intégrations conditionnelles.

### C-03 — Les contrôles de simulation de l'accueil ne simulent rien

Preuve : `devSimulation` change `offline`, `failNextRead` et `aiUnavailable`, mais aucune requête ni fonction de `api.ts` ne lit ces trois champs. `home.tsx` affiche pourtant « Simuler une erreur » et « Passer hors connexion ».

Impact : `failNextRead()` ne provoque aucune erreur ; le mode offline ne bloque aucun fetch. Seul le libellé du bouton change.

### C-04 — La consigne d'urgence de marque peut être écrasée

Preuve : `settings/brand.tsx` modifie `brand.urgencyInstructions`, puis appelle `brandsApi.update(draft.id, draft)`. Dans `api.ts`, le mapping ajoute d'abord `urgencyInstructions`, puis ajoute `patch.escalationRule` sous la même clé `urgencyInstructions`. L'ancien `escalationRule` gagne car il est étalé après.

Impact : l'utilisateur peut croire avoir sauvegardé « Quand faut-il escalader ? » alors que l'ancienne valeur repart au backend.

### C-05 — Le rappel avant publication est uniquement visuel

Preuve : `publications/[id]/schedule.tsx` maintient `reminder` et affiche le sélecteur, mais `publicationsApi.schedule` n'envoie que `scheduledAt` et `timezone`. Aucun modèle backend ne stocke le rappel.

Impact : une option visible ne produit aucun comportement.

### C-06 — Réinitialisation de mot de passe sans canal de livraison

Preuve : `requestPasswordReset` crée et hash le token, puis ne le renvoie ni ne l'envoie ; le commentaire confirme qu'aucun fournisseur d'e-mail n'est câblé.

Impact : en usage réel, l'utilisateur ne peut pas obtenir le lien nécessaire à `reset-password`.

### C-07 — Avatar mobile non implémenté malgré le backend

Preuve : le profil affiche « La sélection d'avatar arrive dans une prochaine version » ; les endpoints avatar existent côté API.

Impact : fonctionnalité backend inaccessible depuis l'application.

### C-08 — Source média « Fichiers » non implémentée

Preuve : `media-picker.tsx` expose le choix `files`, mais retourne immédiatement un message « prochaine version ».

Impact : promesse UI partielle ; seules caméra/galerie fonctionnent.

### C-09 — Environnement d'exécution arrêté et images obsolètes

Preuve : aucun port n'écoute, tous les services Compose sont arrêtés. L'image API annonce 12 migrations contre 13 dans le dépôt ; l'image worker annonce 8 files contre 11.

Impact : l'état déployé observé ne représente pas le code courant et ne peut pas servir de preuve opérationnelle.

### C-10 — Firebase non configuré dans le dernier runtime

Preuve : journaux `firebase_not_configured`; variables FCM optionnelles dans Compose.

Impact : notifications stockées/visibles via REST, mais aucun push sortant.

### C-11 — Surface de suggestions dupliquée et contrat incomplet

Preuve : le même `responseSuggestionRouter` est monté sous `/api/v1/response-suggestions` et `/api/v1/ai/responses`. Toutes ses routes existent donc aux deux préfixes, même lorsque l'OpenAPI ne documente qu'un alias particulier.

Impact : surface d'API plus large que nécessaire, maintenance et autorisations à tester deux fois, clients possibles sur des chemins non documentés.

### C-12 — Documentation/commentaires obsolètes

Preuves :

- `social-media/src/data/api.ts` se présente toujours comme un « In-memory API stand-in » alors qu'il effectue des fetch réels ;
- `social-media/README.md` et `docs/INVENTAIRE_ETAT_REEL.md` décrivent plusieurs domaines comme fixtures de Sprint 01 ;
- les commentaires notifications indiquent encore « aujourd'hui via des fixtures » ;
- certains commentaires de compte social disent que la sync commentaires/métriques n'existe pas encore alors que ces domaines existent ailleurs.

Impact : onboarding trompeur et risque de mauvaises décisions techniques.

### C-13 — Tests graph-api sensibles à l'environnement appelant

Preuve : avec les variables Compose, 182 tests passent et 2 échouent ; avec les variables externes neutralisées, 184 passent. `facebook_client` est un singleton construit à l'import, tandis que certains tests ne patchent que `settings`.

Impact : résultats non hermétiques, échecs différents selon la machine ou la manière de lancer pytest.

### C-14 — Aucune CI/CD dans le dépôt

Preuve : aucun `.github/workflows`, GitLab CI, Jenkinsfile, pipeline Azure ou CircleCI trouvé.

Impact : aucun garde central ne garantit tests, migrations, builds et scans avant intégration.

### C-15 — Fonctionnalité multi-marques incomplète dans l'UI

Preuve : `brandsApi.setActive` existe et le backend expose `/brands/:id/activate`, mais aucun écran ne l'appelle. L'écran de marque choisit seulement la marque déjà active ou en crée une nouvelle.

Impact : un utilisateur membre de plusieurs marques ne dispose pas d'un sélecteur effectif.

### C-16 — Vulnérabilités confirmées reportées de Phase 4

Toujours présentes dans le code lu : routes privilégiées `/facebook/*` non authentifiées, uploads publics graph-api sans plafond applicatif explicite, `mobileRedirectUri` OAuth insuffisamment contraint et health jobs worker interne non authentifié. Les détails et preuves sont dans le rapport Phase 4.

## 7. Risques nécessitant confirmation

| ID | Risque | Preuve/raison | Vérification nécessaire |
|---|---|---|---|
| R-01 | `ai-service` tué ou privé de mémoire | dernier exit code 137 | relancer, surveiller mémoire et raison Docker/OOM |
| R-02 | Initialisation MinIO intermittente | ancien log « stockage indisponible » | rebuild, `/ready`, upload réel et logs horodatés |
| R-03 | Healthchecks trop superficiels | Compose teste `/health`, pas `/ready` | couper DB/S3 et observer orchestration |
| R-04 | SQL worker/graph-api divergent de Prisma | accès brut aux mêmes tables | intégration DB et migration automatique sur base neuve/ancienne |
| R-05 | Images non reproductibles à long terme | tags `node:20-alpine`, `python:3.12-slim`, `postgres:16-alpine` non liés à un digest ; clone pgvector au build | rebuild propre puis SBOM/scanner |
| R-06 | Dépendances mobiles potentiellement superflues | aucune importation directe pour quelques packages Expo | `expo doctor`, build Android/iOS/web avant retrait |
| R-07 | Absence de limites fonctionnelles sur certaines listes/volumes | grand historique, documents et métriques | tests charge et profils SQL |
| R-08 | Dédoublonnage push seulement en mémoire côté mobile | set borné perdu au redémarrage | rejouer un même événement après redémarrage |
| R-09 | Token web dans `sessionStorage` | choix explicite | audit XSS web/CSP |
| R-10 | Accès externe aux ports techniques | Compose publie DB, MinIO, graph-api, IA, worker | test sur réseau hôte et règles firewall |
| R-11 | Échec silencieux de push | erreurs Firebase best-effort, UI REST reste source | monitoring/alerting et métriques de delivery |
| R-12 | Qualité IA variable hors dataset | dataset local et repli deterministic | jeu métier représentatif et revue humaine |
| R-13 | Contrats OpenAPI divergents | documents maintenus manuellement | comparaison automatisée routeur/contrat |
| R-14 | Fonctions externes Meta dépendantes d'App Review | capacités codées mais permissions externes | comptes réels Facebook/Instagram de test |
| R-15 | iOS non fonctionnel au-delà du code partagé | pas de projet natif/bridge Firebase iOS | build iOS et APNs/FCM |

## 8. Dette technique

### D-01 — Client mobile monolithique

`social-media/src/data/api.ts` centralise transport, auth, DTO, mappings et tous les domaines. Une modification transverse peut provoquer des régressions éloignées et les tests chargent souvent le fichier par transformation/mocks.

### D-02 — OpenAPI manuel dans le point d'entrée

`server.js` mélange composition runtime et centaines de lignes de description. Le YAML public constitue une seconde source manuelle. Générer ou valider le contrat réduirait la dérive.

### D-03 — Pas de repository Express

Les services appellent Prisma directement. Cela reste viable pour le MVP, mais rend les tests de service plus difficiles sans vraie base et limite la substitution contrôlée.

### D-04 — Infrastructure FastAPI dupliquée

graph-api et ai-service ont des versions presque parallèles de config, request-id, exceptions, rate limiting et sécurité JWT. Les corrections doivent être reproduites.

### D-05 — JWT de service dupliqué en JavaScript et Python

L'émission/vérification est répartie entre API, worker, graph-api et ai-service. Les tests d'audience existent, mais un package/contrat commun ou tests croisés systématiques réduiraient le risque.

### D-06 — Tests worker à liste manuelle

Le lanceur importe chaque fichier au lieu de découvrir `*.test.js`, cause directe de l'oubli du test concurrent.

### D-07 — Couverture UI étroite

17 tests pour plus de 30 routes Expo. Auth, profil, sécurité, médias, notifications, OAuth, calendrier et plusieurs erreurs ne sont pas exercés au niveau composant/navigation.

### D-08 — Pas de couverture ni seuil

Aucune production de couverture globale ni seuil de régression n'est imposé.

### D-09 — Pas de lint backend/Python orchestré

Le script global ne lance ni ESLint pour l'API/worker, ni Ruff/Black/Mypy pour Python.

### D-10 — Dépréciations observées

- `react-test-renderer` est déprécié avec React 19 ;
- la propriété `package.json#prisma` est annoncée dépréciée avant Prisma 7 ;
- AWS SDK avertit que les versions publiées après début 2027 demanderont Node 22 ;
- warnings AnyIO et LangGraph apparaissent dans les tests Python.

### D-11 — Configuration de développement facile à réutiliser par erreur

Les exemples contiennent des secrets fixes explicitement marqués locaux. Des validations de démarrage interdisent certains placeholders, mais pas nécessairement toutes les valeurs d'exemple dans tous les services.

### D-12 — Jobs externes en best-effort sans télémétrie centralisée

Les erreurs sont souvent journalisées et le lot continue, choix sain pour la résilience, mais aucun compteur/alerting central n'est visible.

### D-13 — Documentation organisée par sprints

Elle conserve l'historique, mais plusieurs documents anciens semblent normatifs alors qu'ils ne reflètent plus le produit. Une page « état courant » générée ou maintenue explicitement manque.

### D-14 — Aucun environnement preprod/prod codifié

Compose représente le local. Aucun manifeste de production, politique de secrets, autoscaling, sauvegarde, observabilité ou rollback n'est versionné ici.

## 9. Code mort potentiel et surfaces inutilisées

### 9.1 Frontend : wrappers définis sans appel d'écran

| Symbole | Endpoint | Conclusion |
|---|---|---|
| `profile.get` | `GET /api/v1/profile` | inutilisé ; la session vient de `/auth/me` |
| `brandsApi.setActive` | `POST /brands/:id/activate` | inutilisé ; confirme l'absence de sélecteur multi-marques |
| `mediaApi.remove` | `DELETE /media/:id` | inutilisé ; nettoyage confié au worker |
| `analyticsApi.insights` | `GET /analytics/insights` | inutilisé ; l'écran génère/historise plutôt que lire l'instantané brut |
| `analyticsApi.sync` | `POST /analytics/sync` | inutilisé malgré le commentaire parlant d'un bouton/pull-to-refresh |
| `competitorsApi.detail` | `GET /competitors/:id` | inutilisé ; l'écran détail utilise directement analytics + posts |
| `competitorsApi.update` | `PATCH /competitors/:id` | inutilisé ; aucune UI d'édition |
| `devSimulation.setAiUnavailable` | aucune | inutilisé et sans consommateur |

### 9.2 Endpoints Express sans appel frontend effectif trouvé

- lecture des préférences profil et opérations avatar ;
- suppression de marque ;
- lecture directe d'un média ;
- `PATCH` de replanification ;
- statut OAuth de secours ;
- raccourci `/comments/:id/escalate` ;
- `/api/v1/ai/retrieve` ;
- export dataset feedback ;
- comparaison analytics par réseau et priorités ;
- plusieurs alias du routeur de suggestions.

Certaines routes sont prévues pour l'administration, la compatibilité ou un futur écran. Elles sont donc « potentiellement mortes », pas forcément à supprimer.

### 9.3 Exports/modules potentiellement morts

- `SkeletonCard` et `dismissKeyboard` dans les composants UI ;
- `TAB_BAR_HEIGHT` ;
- `resetFirebaseApp`, annoncé pour les tests mais sans appel trouvé ;
- `ATTEMPT_STATUS` dans le module partagé ;
- `canTransition`, utilisé par les tests mais pas par le code de production ;
- anciens servlets Java `graph-api/legacy` ;
- API Facebook globale `/facebook/*`, non appelée par l'API/worker actuels qui utilisent `/internal/v1`.

Les fonctions pures exportées uniquement pour les tests mais utilisées dans leur propre fichier ne sont pas classées mortes.

## 10. Incohérences frontend/backend et configuration

| Sujet | Frontend | Backend/configuration | État |
|---|---|---|---|
| Rappel | champ visible | aucun champ/endpoint de rappel | incomplet confirmé |
| Avatar | bouton affiche « prochaine version » | endpoints présents | backend non raccordé |
| Reset password | écran attend un token de lien | token créé mais jamais envoyé | parcours inutilisable hors injection manuelle |
| Multi-marques | aucune activation existante | endpoint d'activation présent | partiel |
| Analytics sync | wrapper présent | endpoint/queue présents | aucune action UI |
| Modification concurrent | wrapper présent | endpoint présent | aucune action UI |
| Push | code Android présent | Firebase absent dans runtime observé | configuré mais inactif |
| Push iOS | ignoré explicitement | FCM accepte `ios` mais pas de pont natif | incomplet |
| Suggestions | un mélange B1/B2 selon actions | routeur complet monté aux deux préfixes | duplication |
| OpenAPI | client réel couvre de nombreux chemins | contrats manuels non strictement synchrones | dette/risque |
| Worker concurrent | API met des jobs en file | image observée n'avait pas les consumers | dérive de déploiement |
| Migration concurrent | schéma en contient 13 | image API observée n'en avait que 12 | dérive de déploiement |

## 11. État global

| Composant | Implémenté | Connecté | Configuré | Testé | État |
|---|---|---|---|---|---|
| Mobile Expo | oui | oui, API Express uniquement | URL locale présente | partiellement : 17 tests + typecheck/lint | probablement opérationnel, non lancé |
| Auth | oui | mobile ↔ API ↔ DB | JWT local | tests unitaires | opérationnel d'après code ; reset e-mail incomplet |
| Profil | oui | oui | aucune config spéciale | validation testée | probablement opérationnel ; avatar incomplet |
| Marques/rôles | oui | oui | DB | logique testée | opérationnel sauf bascule multi-marques et bug de consigne |
| Publications/approbations | oui | oui, jobs/worker | DB/S3/pg-boss | fortement testé, intégration skippée | probablement opérationnel |
| Médias | oui | oui, MinIO | configuré mais ancien warning | logique/type testée | à vérifier en exécution/appareil |
| Comptes sociaux/OAuth | oui | oui, graph-api | dépend Meta | mocks/tests | à vérifier avec Meta réel |
| Commentaires/réponses | oui | oui, graph-api/IA | dépend comptes Meta | fortement testé avec mocks | probablement opérationnel hors Meta réel |
| RAG | oui | oui, pgvector/IA | seuil et cache | testé, une étape embedding skippée | probablement opérationnel ; import natif à vérifier |
| Notifications REST | oui | oui | DB | testé | probablement opérationnel |
| Push Firebase | oui | branché | non configuré dans logs | mocks unitaires | inactif actuellement |
| Analytics/dashboard | oui | oui | DB/worker/IA | fortement testé | probablement opérationnel ; sync UI absente |
| Concurrents | oui | code connecté | dépend Meta | tests présents | code probablement opérationnel, image worker obsolète |
| API Express | oui | tous domaines | `.env` local | 168 succès, 4 skips | arrêtée ; rebuild requis |
| Worker | oui | DB + services | `.env` local | 67 succès explicites | arrêté ; image obsolète |
| graph-api | oui | API/worker ↔ Meta | configuration réelle non prouvée | 184 succès isolés | arrêté ; Meta réel non vérifié |
| ai-service local | oui | API/worker | mode local | 228 succès, 1 skip | arrêté ; dernier exit 137 à expliquer |
| Anthropic | oui, optionnel | ai-service | non configuré observé | doubles/fallback | inutilisé actuellement |
| PostgreSQL/pgvector | oui | API/worker/graph | volume existant | intégrations conditionnelles | arrêté ; état migration courant non prouvé |
| MinIO | oui | API/worker | volume existant | tests par doubles | arrêté ; upload réel à revalider |
| CI/CD | non | non | non | non | absent |

### 11.1 Opérationnels d'après le code et les tests

- validation/auth JWT et rotation ;
- règles métier de publication/approbation/retry ;
- logique worker, y compris concurrents lorsqu'elle est testée directement ;
- analyse NLP locale, génération locale, safety et explications analytics ;
- agrégations analytics et calculs concurrents ;
- centre de notifications REST ;
- typecheck et lint mobile.

### 11.2 Probablement opérationnels après rebuild/démarrage

- API Express et migrations ;
- worker standard ;
- PostgreSQL/pgvector et MinIO ;
- application mobile contre l'API locale ;
- RAG local une fois modèle/cache disponibles.

### 11.3 Partiels ou incomplets

- reset password sans e-mail ;
- avatar ;
- rappel ;
- sélection fichier média ;
- push iOS ;
- multi-marques ;
- synchronisation analytics depuis l'UI ;
- édition de concurrent ;
- CI/CD et observabilité.

### 11.4 Inutilisés ou potentiellement inutilisés

- méthodes frontend recensées en section 9 ;
- alias complets du routeur de suggestions ;
- ancienne API Facebook globale ;
- servlets Java legacy ;
- quelques exports UI/partagés.

## 12. Vérifications manuelles ou d'exécution nécessaires

Ordre recommandé pour obtenir une preuve réelle complète :

1. Recréer/rebuilder la pile via `scripts/start.ps1` et confirmer que les images embarquent 13 migrations et 11 files.
2. Exécuter `scripts/verify-readiness.ps1`, puis vérifier `/ready` de chaque service, pas seulement `/health`.
3. Corriger l'orchestration des tests, puis lancer toutes les suites, y compris mobile, worker concurrent et intégrations PostgreSQL.
4. Vérifier `prisma migrate status` dans l'image API reconstruite.
5. Réaliser un upload image caméra, galerie et appareil physique ; confirmer URL signée MinIO accessible depuis l'émulateur/téléphone.
6. Tester création → approbation → planification → worker → Facebook/Instagram sur comptes Meta de test.
7. Tester OAuth Facebook/Instagram complet, expiration/reconnexion et webhook signé réel.
8. Vérifier collecte commentaires, réponse humaine, idempotence et métriques contre Meta réel.
9. Fournir des credentials Firebase de test et valider token, réception au premier plan, arrière-plan et application tuée sur Android.
10. Décider/implémenter le chemin iOS APNs/FCM, puis le tester sur appareil.
11. Tester le fournisseur Anthropic avec budget/quota contrôlé, refus, timeout et fallback.
12. Tester import PDF/DOCX/TXT/CSV via le sélecteur natif et embedding avec modèle réellement téléchargé.
13. Tester la consigne d'urgence de marque après correction du mapping, avec relecture de la valeur persistée.
14. Décider si le rappel, l'avatar, le sélecteur de fichiers, la bascule de marque et l'édition concurrent doivent être finalisés ou retirés de l'UI/API.
15. Effectuer un test de charge et de reprise après crash sur worker, gros documents, gros comptes sociaux et longues paginations.
16. Rejouer l'audit sécurité de Phase 4 après protection/suppression des routes `/facebook/*` et validation stricte de l'URI OAuth.
17. Mettre en place une CI qui bloque sur tests, intégrations, lint, typecheck, build Expo, validation Prisma/OpenAPI et scan de dépendances/secrets.

## 13. Conclusion

Le code courant est nettement plus avancé que plusieurs documents historiques et que les images Compose arrêtées. La logique pure et les contrats internes importants sont bien couverts, et aucune panne applicative n'est apparue dans les 664 tests explicitement exécutés. Le principal écart n'est donc pas une absence générale d'implémentation, mais une différence entre **code présent**, **tests réellement orchestrés**, **configuration locale**, **image construite** et **preuve d'exécution réelle**.

Aujourd'hui, rien ne tourne. Après rebuild, la pile devrait fournir l'essentiel du produit en mode local, avec IA déterministe et persistance réelle. Les intégrations Meta, Firebase, Anthropic et appareils restent toutefois à démontrer, plusieurs éléments UI sont partiels, et le lanceur de tests doit être fiabilisé avant de pouvoir employer « tous les tests passent » comme garantie.
