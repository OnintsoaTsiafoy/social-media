# Inventaire de l'état réel — Sprint 01

Date de l'inventaire : 30 juillet 2026. La source de vérité est le code présent dans ce dépôt ; le PDF `graph-api(2).pdf` cité dans l'ancien audit n'est pas fourni.

## Dépôts et technologies

| Élément | État constaté | Décision Sprint 01 |
|---|---|---|
| `social-media/` | Application Expo SDK 55, React Native 0.83, TypeScript | Conserver les 31 écrans et remplacer progressivement la façade simulée. |
| `graph-api/` | FastAPI, Pydantic Settings, HTTPX ; routes Facebook existantes | Réutiliser, sécuriser et étendre ; ne pas réécrire la passerelle. |
| API publique | Absente avant ce sprint | Créer le socle Express dans `services/api/`. |
| Worker | Absent avant ce sprint | Créer un processus supervisable ; pg-boss sera ajouté au Sprint 04. |
| Service IA | Absent avant ce sprint | Créer un service FastAPI distinct ; l'analyse arrive au Sprint 09. |
| Base de données et stockage | PostgreSQL et MinIO dans Compose ; schéma Prisma Auth présent | Les tables Auth sont migrées au Sprint 02 ; médias et stockage métier arrivent au Sprint 04. |

## Mobile Expo

Les écrans et la navigation existent déjà. Depuis le Sprint 02, l'authentification de `src/data/api.ts` appelle l'API Express ; s'y ajoutent le profil et les marques (Sprint 03), puis les publications, médias, planification et calendrier (Sprint 04). Les autres domaines conservent une façade en mémoire avec latence et erreurs. Les signatures exportées restent le contrat temporaire des écrans non encore migrés.

| Domaine | Routes existantes | Façade simulée |
|---|---|---|
| Authentification | `index`, `register`, `login`, `forgot-password`, `reset-password` | `auth` |
| Accueil | `home` | `dashboardApi` |
| Publications, média, planification, calendrier | `publications`, `publications/new`, détail, modification, planification, calendrier, média | API réelle depuis le Sprint 04 (`publicationsApi`, `mediaApi`) |
| Hashtags | `hashtags` | `publicationsApi.generateHashtags` (Sprint 10) |
| Commentaires | liste, détail, réponse, historique | `commentsApi` |
| Comptes et profil | profil, comptes sociaux, marque, sécurité, suppression | `profile`, `brandsApi`, `accountsApi` |
| Notifications | centre et paramètres | `notificationsApi` |
| Analytics | vue globale et détail publication | `analyticsApi` |
| OAuth et légal | callback OAuth, conditions, confidentialité | navigation uniquement / contenu statique |

Éléments déjà sains : SecureStore est utilisé pour le jeton de session sur mobile, les tokens sociaux ne sont pas affichés, les états chargement/erreur/vide sont prévus par les hooks, et les réponses IA exigent une validation humaine dans l'interface.

Écarts à traiter par la suite : aucune URL d'API configurable, aucun client HTTP réel, aucun mécanisme de refresh réel, aucune connexion Socket.IO et des statuts de commentaires de démonstration (`untreated`, `treated`) qui devront être adaptés au contrat canonique du Sprint 08.

La correspondance écran → endpoint est détaillée dans [MATRICE_ECRAN_ENDPOINT.md](MATRICE_ECRAN_ENDPOINT.md).

## Passerelle Facebook `graph-api`

Les routes suivantes sont réellement présentes :

| Fonction | Routes présentes |
|---|---|
| Santé | `GET /health`, `GET /ready` (ajouté au Sprint 01) |
| Publications | `GET/POST /facebook/posts`, `PUT/DELETE /facebook/posts/{post_id}` |
| Planification | `POST/GET /facebook/scheduled-posts`, `PUT/DELETE /facebook/scheduled-posts/{post_id}` |
| Commentaires | liste des commentaires, liste des réponses, réponse à un commentaire |
| Statistiques | stats d'un post, stats des community managers, analytics et insights |
| Stories | création, liste et suppression |

Le client HTTPX commun, les schémas Pydantic et la séparation routes → services → client existent. Il n'y a ni authentification interservices, ni CORS contrôlé, ni persistance locale, ni pagination, ni tests de caractérisation, ni Instagram.

Le défaut documenté de mise à jour planifiée avec média est confirmé : `_process_scheduled_post_media` appelle `facebook_client.post_form(..., files=...)`, alors que `post_form` n'accepte pas le paramètre `files`. Cette correction reste volontairement au Sprint 05 ; elle fera d'abord l'objet d'un test de caractérisation.

Avant ce sprint, Pydantic exigeait les trois variables Facebook dès l'import, ce qui empêchait le démarrage sans `.env`. Elles sont maintenant optionnelles pour le processus ; `/health` reste disponible et `/ready` retourne `503 meta_configuration_missing` tant que la configuration Meta est incomplète.

## Variables et secrets

| Service | État | Traitement |
|---|---|---|
| Mobile | URL API configurable ; Auth connectée | Les domaines non-Auth seront branchés selon leur sprint, puis les mocks seront retirés au Sprint 13. |
| API/worker | pas de configuration initiale | `.env.example` racine et Compose ajoutés |
| graph-api | `.env.example` existant, Meta obligatoire au démarrage | Meta rendu optionnel pour probes ; jamais committer `.env` |
| IA | aucun secret requis pour le socle | `AI_MODEL_MODE=stub` seulement en local |

## Écarts et risques ouverts

1. Le PDF source de l'ancien audit est absent. Les éléments déjà vérifiés dans le code sont consignés ici ; tout élément non vérifiable devra être reproduit au Sprint 05.
2. Les permissions, la version de Graph API, l'App Review et les capacités Instagram doivent être validées dans la documentation Meta officielle au Sprint 06/07. Aucun endpoint Meta supplémentaire ne sera supposé avant cette validation.
3. Les services `api`, `worker` et `ai-service` du Sprint 01 sont des socles de santé et de configuration : ils ne prétendent pas fournir les fonctionnalités des sprints suivants.
4. Les mots de passe de l'exemple Compose sont exclusivement locaux. Chaque environnement partagé doit fournir ses secrets hors Git.
