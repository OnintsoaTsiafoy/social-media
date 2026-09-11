# Sprint 04 — publications, médias et scheduler

Cette livraison applique la tranche Sprint 04 du plan
(`sprint_listing/SPRINT_04_PUBLICATIONS_MEDIAS_SCHEDULER.md`) : créer, modifier,
planifier et exécuter une publication de manière persistante, avec un connecteur
social simulé. Aucun écran mobile n'a été recréé ; les écrans existants sont
branchés sur l'API réelle.

## Persistance

La migration `20260830000000_publications_media_scheduler` ajoute :

| Table | Rôle |
|---|---|
| `publications` | Contenu, langue, hashtags, statut, planification, fuseau, suppression logique. |
| `publication_targets` | Une ligne par réseau visé : statut, identifiant externe, dernière erreur, nombre de tentatives. |
| `publication_media` | Rattachement ordonné des médias à une publication. |
| `scheduled_publications` | Planification courante d'une publication et identifiant du job pg-boss. |
| `publication_delivery_attempts` | Une ligne par tentative d'envoi, avec clé d'idempotence unique. |
| `idempotency_keys` | Réponses mémorisées des commandes portant une `Idempotency-Key`. |

`media` gagne `purpose` et `deleted_at` : un média déposé mais non rattaché reste
`TEMPORARY` et devient supprimable par le nettoyage automatique.

Les statuts sont des enums PostgreSQL : `PublicationStatus`
(`DRAFT`, `SCHEDULED`, `PUBLISHING`, `PUBLISHED`, `PARTIALLY_PUBLISHED`,
`FAILED`, `CANCELLED`), `PublicationTargetStatus`, `DeliveryAttemptStatus`,
`SocialProvider` et `ScheduleStatus`.

## API livrée

| Méthode et route | Rôle minimal | Réponse |
|---|---|---|
| `POST /api/v1/media` | membre de la marque | `201` métadonnées + URL signée |
| `GET /api/v1/media/{mediaId}` | membre | `200` métadonnées + URL signée |
| `DELETE /api/v1/media/{mediaId}` | membre | `204`, ou `409 media_in_use` |
| `GET /api/v1/publications` | `VIEWER` | liste paginée `{ items, page, pageSize, total }` |
| `GET /api/v1/publications/counts` | `VIEWER` | compteurs par statut |
| `POST /api/v1/publications` | `COMMUNITY_MANAGER` | `201` publication |
| `GET/PATCH/DELETE /api/v1/publications/{id}` | `VIEWER` / `COMMUNITY_MANAGER` | `200`, `200`, `204` |
| `POST/PATCH/DELETE /api/v1/publications/{id}/schedule` | `COMMUNITY_MANAGER` | `201`/`200`/`200` |
| `POST /api/v1/publications/{id}/publish` | `COMMUNITY_MANAGER` | `202` `{ jobId, publication }` |
| `POST /api/v1/publications/{id}/retry` | `COMMUNITY_MANAGER` | `202` `{ jobId, publication }` |
| `GET /api/v1/calendar` | `VIEWER` | publications planifiées ou publiées sur la période |

Les enveloppes et les codes d'erreur suivent [CONTRATS_API.md](CONTRATS_API.md).
Le Sprint 04 ajoute les codes métier `media_too_large` (413),
`media_type_not_allowed` (415), `media_in_use` (409), `media_not_ready` (422) et
`idempotency_conflict` (409).

Une publication d'une marque dont l'utilisateur n'est pas membre retourne `404`,
jamais `403` : son existence n'est pas divulguée, comme pour les marques.

## Médias

Le fichier est reçu en `multipart/form-data`, gardé en mémoire, puis inspecté :
le type est déduit des octets réels (JPEG, PNG, WebP — ADR-08), jamais du nom ni
du `Content-Type` annoncé. Les limites serveur reprennent celles que le mobile
applique avant l'envoi : 8 Mo et 320 px minimum.

Les clés d'objet suivent la spécification S3/MinIO :

```text
temporary/{userId}/{mediaId}.jpg                              dépôt initial
brands/{brandId}/publications/{publicationId}/{mediaId}.jpg   après rattachement
users/{userId}/avatars/{mediaId}.jpg                          avatar
```

Le rattachement à une publication déplace l'objet (copie puis suppression) et
passe le média en `READY` : le nettoyage des objets temporaires ne peut plus
l'atteindre. Le bucket est privé ; le mobile ne reçoit que des URL signées de
courte durée (`MEDIA_URL_TTL_SECONDS`, 15 minutes par défaut) et jamais une clé
de stockage.

## Planification et exécution

L'API ne publie jamais elle-même : elle crée un job pg-boss persistant et répond
`202`. Le worker le consomme.

| File | Créée par | Effet |
|---|---|---|
| `publish-scheduled-publication` | `POST /schedule` (`sendAfter`) | envoi à l'heure prévue |
| `publish-publication-now` | `POST /publish` | envoi immédiat |
| `retry-failed-publication` | `POST /retry` et le worker | relance des réseaux en échec |
| `cleanup-temporary-media` | planification horaire pg-boss | suppression des objets orphelins de plus de 24 h |

Déroulé d'un envoi, dans `services/worker/src/delivery.js` :

1. pour un job planifié, vérifier que la planification est toujours `PENDING` ;
2. prendre la publication par une transition conditionnelle vers `PUBLISHING` ;
3. pour chaque cible livrable, la verrouiller (`PENDING`/`FAILED` → `SENDING`) ;
4. enregistrer la tentative avec une clé d'idempotence unique
   `{publicationId}:{PROVIDER}:{numéro}` ;
5. appeler le connecteur social ;
6. écrire le résultat sur la tentative et sur la cible ;
7. recalculer le statut global à partir de l'état réel des cibles ;
8. reprogrammer les seules erreurs temporaires, avec le backoff 1 min, 5 min,
   15 min puis 1 h (5 tentatives au maximum).

### Fuseaux horaires

`scheduledAt` est reçu en instant absolu (ISO 8601 avec décalage) et stocké en
`timestamptz`, donc en UTC. `timezone` est conservé à côté pour réafficher
l'heure locale voulue par le community manager. Le mobile envoie le fuseau de
l'appareil.

### Connecteur social simulé

Les vrais appels Meta passent par `graph-api` (`/internal/v1`, Sprint 05) et
exigent des comptes liés par OAuth (Sprint 06). Le Sprint 04 exécute donc le
workflow réel avec un connecteur déterministe
(`services/shared/social-provider.js`), pilotable depuis le contenu :

| Marqueur dans le texte | Effet |
|---|---|
| `[[TIMEOUT]]` | délai dépassé, erreur temporaire, retry automatique |
| `[[FAIL_TEMP]]` | réseau indisponible, retry automatique |
| `[[FAIL_PERM]]` | contenu refusé, aucun retry automatique |
| `[[FAIL_FACEBOOK]]` / `[[FAIL_INSTAGRAM]]` | échec d'un seul réseau, statut partiel |

## Garanties contre le double envoi

Quatre protections indépendantes, exigées par les critères d'acceptation :

1. `singletonKey` pg-boss par publication : un seul job actif à la fois ;
2. transition conditionnelle vers `PUBLISHING` : un second appel obtient `409` ;
3. verrou conditionnel par cible : une cible `SENT` n'est jamais resélectionnée ;
4. clé d'idempotence unique par tentative : un job rejoué après un redémarrage ne
   refait pas une tentative déjà enregistrée.

L'en-tête `Idempotency-Key` (facultatif) ajoute la mémorisation de la réponse
pendant 24 heures pour `publish` et `retry`. Le mobile ne l'envoie pas : ses
écrans s'appuient sur `useMutation` (un seul appel en vol) et sur les verrous
serveur ; l'en-tête reste disponible pour les intégrations tierces.

## Mobile

`src/data/api.ts` : `publicationsApi` et le nouveau `mediaApi` appellent l'API
réelle. Restent simulés `generateHashtags` et `detectKeywords` (Sprint 10), ainsi
que les domaines commentaires, comptes sociaux, notifications, tableau de bord et
analytics (Sprints 06 à 12).

Écrans branchés, sans création d'écran : liste (07), création (08), modification
(09), planification (12), calendrier (13), détail (14) et sélection de média
(10), qui effectue désormais un véritable envoi multipart avec barre de
progression.

L'envoi étant asynchrone, les écrans annoncent « Envoi lancé. Actualisez pour
suivre le résultat. » plutôt qu'une publication déjà envoyée : le temps réel
arrive au Sprint 11 (Socket.IO).

## Décisions et limites

| Décision | Motif |
|---|---|
| Les cibles sont identifiées par `provider`, `social_account_id` restant nullable et sans clé étrangère | La table `social_accounts` est livrée au Sprint 06 ; anticiper l'OAuth ici aurait figé un modèle non validé. |
| Annuler une planification ramène la publication à `DRAFT` | Elle reste modifiable et replanifiable. `CANCELLED` est réservé à un abandon explicite, non exposé par les écrans actuels. |
| Le worker lit et écrit en SQL (`pg`), sans client Prisma | Prisma reste le propriétaire unique du schéma et des migrations (ADR-05) ; le worker n'a ni migration ni génération de client à embarquer, et les verrous conditionnels s'expriment directement. |
| Modules purs partagés dans `services/shared/` | Le statut global doit être calculé à l'identique par l'API et par le worker. Ces modules n'importent aucune dépendance npm : chaque service garde ses propres `node_modules`. |
| pg-boss est figé en `^10.4.2` | Les versions 11 et 12 exigent Node ≥ 22, alors que les images de service et le poste de développement utilisent Node 20. |
| `S3_ENDPOINT` et `MEDIA_BUCKET` rejoignent les variables exigées par `/ready` | Sans stockage, une publication avec image échouerait au moment de l'envoi ; la sonde doit le dire avant. |
| Le port 3001 du worker est publié dans Compose | `scripts/verify-readiness.ps1` interrogeait `localhost:3001` alors que le service n'exposait aucun port : la sonde ne pouvait pas répondre. |
| Une image par publication | ADR-08 ; l'écran mobile annonce déjà ce périmètre. Les tables supportent plusieurs médias ordonnés pour la suite. |
| Les paramètres SQL du worker portent un cast explicite (`$1::uuid`, `$2::int`) | Sans cast, la requête dépend de l'inférence de type du pilote : la vérification sur base réelle a montré deux échecs (`make_interval`, `uuid = text`) selon le client utilisé. |

### Points Meta non vérifiés

Aucun appel Meta n'est réalisé dans ce sprint. Les limites réelles (taille et
formats acceptés par Facebook et Instagram, quotas de publication, délais de
planification autorisés, permissions requises) doivent être revérifiées dans la
documentation officielle au moment des Sprints 05 à 07, avant toute mise en
production.

## Tests

```powershell
npm --prefix services/api test        # 31 tests
npm --prefix services/worker test     # 13 tests
./scripts/test.ps1                    # + pytest graph-api, typecheck et lint mobile
```

Couverture des exigences du sprint :

| Exigence | Test |
|---|---|
| scénario nominal | `worker/test/delivery.test.js` — les deux réseaux passent en `SENT`, statut `PUBLISHED` |
| paramètres invalides | `api/test/publications.test.js` — contenu vide, UUID invalide, réseau dupliqué, fuseau inconnu, période inversée |
| ressource d'une autre marque | filtre `accessibleWhere` vérifié sur base réelle (voir ci-dessous) |
| erreur du service externe | échec temporaire, permanent, timeout et échec partiel |
| double soumission | rejeu de job, tentative déjà enregistrée, hash d'idempotence stable |
| non-régression | suites Sprints 01 à 03 inchangées et vertes |

Les migrations, les requêtes SQL du worker et les services Prisma ont été
exécutés contre un vrai moteur PostgreSQL embarqué (PGlite) : structure identique
entre migrations et schéma Prisma, envoi planifié, rejeu sans doublon, échec
partiel avec retry ciblé, nettoyage des médias, isolation par utilisateur, et
retour au brouillon lorsque la file de travaux est indisponible.

## Scénario de vérification manuelle

1. `./scripts/start.ps1` puis `./scripts/seed.ps1` à la racine.
2. `./scripts/verify-readiness.ps1` : les sondes des quatre services répondent,
   worker compris (port 3001 désormais publié).
3. Importer `contracts/hootly-api.postman_collection.json`, exécuter
   « Connexion » puis « Marques » : les variables sont renseignées.
4. « Déposer un média » avec une image JPEG de plus de 320 px, puis rejouer avec
   un fichier texte renommé en `.jpg` : `415 media_type_not_allowed`.
5. « Créer un brouillon », puis « Publier maintenant » : réponse `202`, statut
   `publishing`. Relire le détail : `published`, avec un identifiant externe par
   réseau.
6. Créer une publication contenant `[[FAIL_INSTAGRAM]]` et la publier : statut
   `partially_published`, puis un retry automatique une minute plus tard.
7. Planifier une publication à deux minutes, arrêter le worker
   (`docker compose stop worker`), attendre l'échéance, redémarrer le worker :
   l'envoi part au redémarrage, sans doublon — le job est persistant.
8. Sur mobile (`npm --prefix social-media start`) : créer une publication avec
   image depuis l'écran 08, vérifier la barre de progression réelle, planifier
   depuis l'écran 12, contrôler l'apparition dans le calendrier (13) et le détail
   des cibles (14).
