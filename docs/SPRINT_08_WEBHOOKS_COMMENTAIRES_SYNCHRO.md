# Sprint 08 — Webhooks Meta, persistance des commentaires, réponses contrôlées

Cette livraison applique la tranche Sprint 08 du plan
(`sprint_listing/SPRINT_08_WEBHOOKS_COMMENTAIRES_SYNCHRO.md`) : réception
fiable des commentaires (webhook + synchronisation de secours), leur
persistance, et un flux de réponse contrôlé avec idempotence. Les écrans
mobiles existants (boîte de réception, détail, réponse, historique —
Écrans 17-20) ont été branchés sur l'API réelle, pas recréés ; les parties
IA de ces écrans (`analyse`, `generateResponse`, `saveResponse`,
`rejectResponse`) restent des fixtures, hors périmètre (Sprints 09/10).

## Modèle de données

Migration `20260912010000_webhooks_comments_replies` :

| Table | Rôle |
|---|---|
| `social_comments` | Un commentaire Meta, lié à un `social_accounts`. `@@unique([socialAccountId, externalCommentId])` — clé d'upsert du webhook et de la synchronisation. |
| `comment_status_history` | Historique append-only des changements de statut ; écrit par `graph-api` (réponse envoyée) et par Express (actions manuelles). |
| `webhook_events` | Journal brut des livraisons webhook, dédupliqué par `(provider, payload_hash)` — écrit uniquement par `graph-api`. |
| `sent_responses` | Une seule ligne par commentaire, réclamée avant l'appel Meta (`ON CONFLICT (comment_id) DO UPDATE ... WHERE status = 'FAILED'` — un échec peut être retenté, un succès non). |

`CommentStatus` = `NEW, PROCESSED, IGNORED, ESCALATED` (4 valeurs, pas les 7
de la fiche sprint) : `ANALYZING`/`ANALYZED`/`IN_PROGRESS` sont des états du
pipeline IA (Sprint 09) que rien dans ce sprint ne pose ni ne lit — ajoutés
plus tard par `ALTER TYPE ... ADD VALUE` quand l'analyse existera réellement,
plutôt que d'anticiper un schéma. Le mobile `CommentStatus` est aligné
verbatim (même précédent que `AccountStatus`, Sprint 06) : `untreated` a
disparu (jamais distingué de `new` dans le code existant) et `treated` est
devenu `processed`.

## Webhook Meta (`GET`/`POST /webhooks/meta`)

Public, sans JWT de service — même précédent que `/oauth/{provider}/callback`
(protégé par un mécanisme propre à Meta, pas le nôtre) ; exempté de la limite
de débit par défaut (Meta relance agressivement sur non-200). Le GET répond
au challenge d'abonnement (`hub.challenge` en texte brut si
`hub.verify_token` correspond à `META_WEBHOOK_VERIFY_TOKEN`, nouvelle
variable ajoutée à `compose.yaml` et aux deux `.env.example` dès ce sprint).

Le POST vérifie `X-Hub-Signature-256` sur le corps brut (jamais un modèle
Pydantic parsé) avec `hmac.compare_digest` ; le secret utilisé dépend du
champ `object` du payload (`"page"` → `FACEBOOK_APP_SECRET`, `"instagram"` →
`INSTAGRAM_APP_SECRET`) puisque ce sont deux Apps Meta distinctes depuis le
Sprint 07. **Simplification par rapport au plan initial** : Facebook et
Instagram incluent tous deux le contenu complet du commentaire directement
dans la charge utile du webhook (vérifié contre la documentation Meta
actuelle) — aucun appel Meta supplémentaire n'est donc jamais nécessaire pour
« compléter » un commentaire, et tout le traitement (dédup, résolution du
compte, upsert) tourne de façon synchrone dans la requête plutôt que dans une
`BackgroundTask` FastAPI, évitant au passage un vrai piège de ce mécanisme
(confirmé en revue d'architecture : une exception levée dans une
`BackgroundTask` ne passe jamais par les gestionnaires d'exceptions de
`main.py`, Starlette l'exécutant après l'envoi de la réponse).

Facebook (`object:"page"`, champ générique `feed`, `item:"comment"`,
`verb:"add"|"edited"|"remove"`) et Instagram (`object:"instagram"`, champ
dédié `comments`, pas de `verb` — une suppression Instagram n'est détectée
que par la synchronisation de secours) ont des formes de charge utile
différentes, normalisées par `modules/webhooks/parser.py` avant persistance.
L'upsert ne touche jamais `status` : un commentaire déjà `PROCESSED`/
`IGNORED` ne revient pas à `NEW` si Meta renvoie une édition.

## Synchronisation de secours

Cron `services/worker` toutes les 15 minutes (`sync-social-comments`), même
mécanisme que `refreshExpiringTokens` (Sprint 06) : le worker **lit**
`social_accounts`/`publication_targets` en SQL direct pour choisir les
comptes à resynchroniser, puis appelle `graph-api` en HTTP pour l'action
réelle (le worker n'écrit jamais ces tables lui-même — vérifié sur
`token-refresh.js`, corrigeant une hypothèse initiale du plan).

**Écart vérifié par rapport au plan** : `since` a été retiré du contrat
`/internal/v1/comments/sync` (pas seulement pour Instagram comme envisagé) —
vérification directe de la documentation Meta actuelle : ni le fil de
commentaires Facebook ni celui d'Instagram ne supporte un filtre par date
(« Comments cannot be filtered by timestamp » est la formulation de Meta
elle-même pour Instagram), et l'ordre par défaut de Facebook est
chronologique croissant, ce qui aurait de toute façon rendu une optimisation
« s'arrêter dès qu'on voit un commentaire ancien » incorrecte. La
synchronisation revisite donc entièrement chaque post connu à chaque
exécution (plafonné à `comments_sync_max_pages_per_post`, 20 pages), en
s'appuyant sur l'upsert par clé naturelle pour que revoir un commentaire
inchangé soit gratuit. `graph-api` reste seul écrivain de
`last_comments_sync_at` (colonne présente depuis le Sprint 06, jamais écrite
jusqu'ici), mis à jour dans le même appel que la persistance.

**Limite réelle, documentée pas cachée** : la synchronisation ne couvre que
les posts publiés par Hootly (`PublicationTarget.externalPublicationId`) —
rien n'énumère les posts organiques d'une Page. Un commentaire manqué par
webhook sur un post organique n'a aucun rattrapage ce sprint.

> **Mise à jour.** L'import des publications d'une page
> ([SYNCHRO_PUBLICATIONS.md](SYNCHRO_PUBLICATIONS.md)) énumère désormais le fil de
> la Page et en fait des publications locales : ce filet couvre aussi les posts
> organiques — mais seulement les 50 plus récents de chaque compte, pour ne pas
> relire un historique entier toutes les 15 minutes.

## API Express

| Route | Rôle |
|---|---|
| `GET /api/v1/comments` | Liste paginée+filtrée par marque (`status`/`network`/`publicationId`/`search`) ; les filtres IA (sentiment/priorité/intention) ne sont pas envoyés, rien ne les persiste encore. |
| `GET /api/v1/comments/counts` | `untreated`/`highPriority`/`pendingAiResponses` — les deux derniers valent 0 tant que l'IA n'existe pas (jamais une valeur inventée). |
| `POST /api/v1/comments/sync` | « Synchroniser maintenant » (pull-to-refresh mobile) — déclenche le même appel que le cron, à la demande. |
| `GET /api/v1/comments/{id}` / `/history` | Détail et historique (union de sources : `comment_received`, `status_changed`/`escalated`, `send_failed`/`response_sent` — les genres IA n'apparaissent simplement jamais, pas un point à retoucher). |
| `PATCH /api/v1/comments/{id}/status` | `processed`/`ignored`/`escalated` uniquement — jamais `new` (état système, jamais une action manuelle). |
| `POST /api/v1/comments/{id}/escalate` | Raccourci sur la même fonction que le PATCH — les deux routes ne peuvent pas diverger. |
| `POST /api/v1/comments/{id}/reply` | Absente de la liste « API concernées » de la fiche sprint, ajoutée ici : exigée par sa propre tâche du Jour 5 et par l'écran mobile `approveAndSend` déjà existant. |

Express lit `social_comments`/`comment_status_history`/`sent_responses`
**directement via Prisma** (même logique que `social_accounts` : pas secret,
contrairement aux tokens) et n'écrit `status` que pour les actions locales —
`graph-api` reste seul écrivain du contenu et écrit aussi `status` quand une
réponse part réellement (même double-écrivain déjà établi pour
`PublicationTarget.status`).

## Réponse contrôlée et idempotence

`POST .../reply` mint une clé d'idempotence **déterministe**
(`comment-reply:{commentId}`) plutôt que d'exiger que le mobile en gère une —
un commentaire n'a qu'une seule réponse valide, jamais plus. Deux garde-fous
indépendants empêchent un double envoi :

1. `sent_responses` réclamé (`INSERT ... ON CONFLICT (comment_id) DO UPDATE
   ... WHERE status = 'FAILED'`) **avant** l'appel Meta — le vrai garde-fou.
   **Bug trouvé et corrigé avant toute mise en service** : un simple
   `ON CONFLICT DO NOTHING` aurait rendu un échec définitif (aucune tentative
   suivante n'aurait jamais pu réclamer la ligne à nouveau) — la clause
   `WHERE status = 'FAILED'` autorise explicitement un nouvel essai après un
   échec tout en bloquant une ligne déjà `SUCCEEDED` ou en cours.
2. `service_idempotency_keys` (Sprint 06) en plus, pour rejouer la même
   réponse HTTP à un retry légitime côté Express — n'écrit qu'après succès,
   donc insuffisant seul (fenêtre entre l'acceptation Meta et l'écriture du
   cache), mais utile pour son propre rôle.

`graph-api` route désormais `/internal/v1/comments/reply` sur l'id de
commentaire Hootly (`commentId`) plutôt que sur un triplet
provider/compte/id-externe : rien avant ce sprint n'avait de ligne
`social_comments` à résoudre, donc l'ancienne forme n'avait rien à cibler.
`userId` est passé explicitement dans le corps (même raison que
`AuthorizationUrlRequest.userId` : l'appelant est un JWT de service, pas un
JWT utilisateur) pour attribuer la réponse et le changement de statut.

**Correctif adjacent découvert en câblant cette route** : `TOKEN_EXPIRED`
(code levé par la résolution de compte de `internal_service.py`, utilisé
jusqu'ici uniquement par le worker qui ne traduit pas les codes) n'était pas
dans la table de traduction `services/api/src/lib/socialServiceClient.js` —
en fuite vers le mobile sous sa forme brute, il n'aurait jamais déclenché le
message dédié `token_expired` déjà existant côté mobile. Ajouté à
`CODE_TRANSLATIONS` avant que `comments/reply` (premier appelant Express de
ce chemin) ne l'expose réellement.

## Tests

`graph-api` : 153 tests (respx, aucun appel Meta réel) — nouveaux fichiers
`test_webhook_routes.py` (15, dont l'exemption de limite de débit et la
non-régression du statut sur une édition Meta), `test_comment_sync_persistence.py`
(6, dont le plafond de pages et la détection de suppression), et l'extension
des tests de réponse dans `test_internal_routes_per_account.py` (dont le
nouvel essai après échec). `services/api` : 51 tests, dont
`comments.test.js` (schémas) et l'extension de
`social-service-client.test.js` pour `TOKEN_EXPIRED`. `services/worker` :
27 tests, dont `comment-sync.test.js` (4, calqué sur `token-refresh.test.js`).
Mobile : `tsc --noEmit` et `expo lint` verts, bundle Metro web vérifié
(1434 modules).

## Scénario de vérification manuelle exécuté

1. `docker compose up --build`, sonde des 4 services : OK.
2. Challenge webhook GET avec le bon/mauvais `hub.verify_token` : 200 texte
   brut / 403.
3. POST webhook signé avec le vrai `local-dev-app-secret`, payload Facebook
   réaliste : commentaire persisté correctement (auteur, contenu, statut
   `NEW`) ; POST identique rejoué : toujours un seul commentaire, un seul
   `webhook_events` (déduplication confirmée) ; signature invalide : 403,
   rien persisté.
4. Cycle complet via l'API Express sur ce commentaire réel : liste, compteurs,
   détail, historique, `PATCH status=processed`, `POST escalate` (historique
   mis à jour à chaque fois, acteur attribué) ; 404 sur un commentaire
   inexistant, 401 sans authentification, 400 sur `status=new`.
5. Synchronisation de secours déclenchée manuellement sur le worker contre la
   pile réelle : compte sélectionné, post publié par Hootly retrouvé, appel
   réel à `graph-api` → Meta (token factice) → échec propre `validation_failed`,
   aucun crash à aucune couche.
6. Réponse à un commentaire réel avec un token Meta factice : rejet Meta réel
   et propre (`OAuthException`, code 190) ; `sent_responses` marqué `FAILED`,
   commentaire resté `NEW` (pas résolu silencieusement) ; nouvel essai
   immédiatement accepté (pas bloqué par le premier échec) ; après un succès
   simulé, un troisième essai correctement bloqué en `409` avant tout appel
   Meta ; réponse à un commentaire marqué supprimé : `409` propre.
7. Écriture directe de `social_comments_repository.set_status()` vérifiée
   contre Postgres réel : la ligne `comment_status_history` est bien créée
   (mécanisme exact utilisé par `reply_comment` en cas de succès réel, non
   autrement testable en direct sans compte Meta réel).

## Décisions Meta vérifiées (recherche directe, pas supposées)

Facebook : commentaires reçus sur le champ générique `feed`
(`item:"comment"`, `verb:"add"|"edited"|"remove"`), pas un champ dédié ;
ordre par défaut chronologique croissant ; pas de filtre par date sur le fil
de commentaires. Instagram : champ dédié `comments`, contenu complet inclus
dans la charge utile, pas de `verb` (donc pas de signal de suppression par
webhook), pas de filtre par date non plus.

## Décisions Meta à revérifier en direct (jamais supposées, non vérifiables sans App réelle)

Abonnement réel au webhook depuis le Dashboard Meta App Review (nécessite le
compte Meta Developer de l'utilisateur — vérifié ici uniquement par calcul
manuel d'une signature HMAC valide, sans tunnel public) ; permissions exactes
nécessaires pour répondre à un commentaire en conditions réelles ; en-têtes
de rate-limit Meta exacts (seul le `429`/`Retry-After` générique du Sprint 05
s'applique aujourd'hui).

## Hors périmètre (rappel, cf. plan)

Déclenchement réel de l'analyse IA (Sprints 09/10) ; énumération des posts
organiques d'une Page ; tunnel public pour un abonnement webhook réel ;
soumission App Review réelle.
