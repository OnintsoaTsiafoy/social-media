# Sprint 05 — durcissement et sécurisation de graph-api (Facebook)

Cette livraison applique la tranche Sprint 05 du plan
(`sprint_listing/SPRINT_05_DURCISSEMENT_GRAPH_API_FACEBOOK.md`) : fiabiliser
le connecteur Facebook existant sans le réécrire, puis ajouter la couche
`/internal/v1` protégée par JWT de service. Aucun écran mobile n'a été
recréé ; aucun écran ne consomme encore `graph-api` directement (le mobile ne
parle qu'à Express).

## Défauts corrigés

| Défaut | Fichier | Correction |
|---|---|---|
| `TypeError` en éditant un post planifié avec média | `modules/facebook/services/posts_service.py` (`_process_scheduled_post_media`) | `facebook_client.post_form(..., files=...)` → `post_multipart(..., files=...)`, seule méthode acceptant `files`. |
| `created_time` absent fait planter `/posts/{id}/analytics` | `modules/facebook/services/post_analytics_service.py` | `date`/`time` deviennent `null` (indisponible) au lieu de lever `ValueError`. |
| Erreurs insights toutes masquées en zéro | `post_analytics_service.py` | Seul un échec Meta connu (`GraphAPIError`) rend les métriques `null` ; toute autre exception continue de se propager (elle n'est plus avalée silencieusement). |
| Sous-pièces jointes jamais demandées à Meta | `post_analytics_service.py` | `attachments{...}` inclut désormais `subattachments{...}` : les posts multi-photos remontent tous leurs médias. |
| `since`/`until` transmis à Meta sans validation | `posts_service.py` | Rejet local (`400 validation_failed`) si ce n'est ni un timestamp Unix ni `YYYY-MM-DD`. |

## Pagination

Nouveau modèle partagé `PaginatedList[T]` (`modules/facebook/schemas/pagination.py` :
`{data, paging: {cursors: {before, after}, hasNextPage, hasPreviousPage}}`),
appliqué aux 5 endpoints de liste : `GET /facebook/posts`, `/scheduled-posts`,
`/posts/{id}/comments`, `/comments/{id}/replies`, `/stories`. Tous acceptent
désormais `limit` (1 à 100, défaut 25), `after`, `before`. `community-managers/stats`
reste un agrégat non paginé (hors périmètre du jour 3).

## Erreurs, résilience, sécurité

- **Enveloppe stable** : toute erreur (Meta, validation locale, 422 Pydantic,
  429) répond désormais `{"error": {"code", "message", "requestId"}}` au lieu
  du `{"detail": ...}` par défaut de FastAPI (`main.py`, `core/exceptions.py`).
  Table de codes : `validation_failed` (400), `not_found` (404),
  `rate_limited` (429), `provider_unavailable`/`provider_timeout`
  (502/503/504), `unprocessable` (422 métier), `authentication_required` /
  `token_expired` / `forbidden` (nouveauté `/internal/v1`).
- **Réseau** : toute erreur `httpx` (timeout, connexion refusée) est
  interceptée dans `FacebookClient._send` — plus aucun appel Meta ne peut
  faire remonter une exception non gérée en 500 générique.
- **429** : `Retry-After` est relayé si Meta le fournit, sinon une valeur par
  défaut documentée (`60`) est utilisée — le format exact des en-têtes de
  rate-limit Meta pour cette app (`X-Business-Use-Case-Usage` ?) reste à
  vérifier en conditions réelles (voir « Décisions Meta non vérifiées »).
- **Timeouts configurables** : `GRAPH_API_DEFAULT_TIMEOUT_SECONDS` (30s) et
  `GRAPH_API_UPLOAD_TIMEOUT_SECONDS` (120s) dans `core/config.py`.
- **`access_token` jamais loggé** : `_redact_url` retire systématiquement le
  paramètre avant toute ligne de log.
- **JWT de service** (`core/security.py`, `require_service_jwt`) : HS256,
  secret `SERVICE_JWT_SECRET`, claims `{sub, aud:"social-service", scope,
  type:"service", jti, exp}`. Un JWT mobile est toujours refusé (`type`
  vérifié). Scope `social:read`/`social:write` par route.
- **CORS** : laissé fermé par défaut (`CORS_ALLOWED_ORIGINS` vide) —
  `/internal/v1` est serveur-à-serveur et `/oauth/*/callback` (Sprint 06) sera
  une navigation top-level, ni l'un ni l'autre n'est concerné par CORS.
- **Rate limiting** : `slowapi`, 120 req/min par IP par défaut
  (`core/rate_limit.py`), affinable par route plus tard.
- **`x-request-id`** : généré ou propagé (`core/middleware.py`), renvoyé en
  en-tête sur toute réponse et inclus dans le corps des erreurs.
- **Audit minimal** : chaque appel `/internal/v1` et chaque rejet de JWT sont
  journalisés (`core/security.py`, logger `graph_api.security`) avec `sub` et
  scope — pas encore de table `audit_logs` (graph-api n'a pas de base avant le
  Sprint 06).

## `/internal/v1` (nouveau, Facebook uniquement à ce sprint)

Implémente les 4 chemins déjà stubés dans
[`contracts/openapi/social-internal.yaml`](../contracts/openapi/social-internal.yaml)
(corrigé de `202` vide vers `200` + corps réel, qui correspond à ce que
`sprint_listing/APIS/03_FASTAPI_RESEAUX_SOCIAUX.md` documentait déjà) :

| Route | Rôle | Limite connue de ce sprint |
|---|---|---|
| `POST /internal/v1/publications/publish` | Publier texte + images par URL | Résout toujours vers la Page globale `.env` (pas de `social_accounts` avant le Sprint 06) ; vidéo par URL non supportée. |
| `POST /internal/v1/comments/sync` | Récupérer des commentaires normalisés | Un curseur unique appliqué à plusieurs `publicationExternalIds` n'a de sens que pour un seul post à la fois. |
| `POST /internal/v1/comments/reply` | Répondre à un commentaire | — |
| `POST /internal/v1/metrics/sync` | Récupérer des métriques (`null` si indisponible) | — |

`publications/publish` et `comments/reply` exigent `Idempotency-Key`. Le cache
associé est **en mémoire process** (`modules/facebook/services/idempotency.py`) :
protection réelle contre une double soumission immédiate, mais non persistée
ni partagée entre replicas — remplacé par la table `service_idempotency_keys`
au Sprint 06 Jour 1.

**Non-objectif explicite de ce sprint** : le worker continue d'utiliser
`mockSocialProvider` (`services/shared/social-provider.js`) — brancher un
appel réel dès maintenant ferait publier toutes les marques sur l'unique Page
globale configurée (bug multi-tenant). Le vrai branchement arrive au
Sprint 07 une fois les comptes par marque disponibles.

## Fichiers Java legacy

Déplacés de `graph-api/api/routes/` vers `graph-api/legacy/`
(voir [`legacy/README.md`](../graph-api/legacy/README.md)) : confirmés non
importés par le runtime Python, non compilés par le `Dockerfile`. L'adresse IP
interne codée en dur (`192.168.16.93`) qu'ils contenaient a été remplacée par
un placeholder.

## Correction adjacente (câblage Compose)

`compose.yaml` ne transmettait `FACEBOOK_APP_ID`/`FACEBOOK_PAGE_ID`/
`FACEBOOK_PAGE_ACCESS_TOKEN` à aucun service — `graph-api` répondait toujours
`503 meta_configuration_missing` sous `docker compose up`, quel que soit le
contenu de `graph-api/.env`. Corrigé en même temps que l'ajout de
`SERVICE_JWT_SECRET` (`.env.example` racine et `compose.yaml`).

## Tests

`graph-api/tests/` (respx — aucun appel réseau réel vers Meta) :
`test_facebook_posts.py`, `test_facebook_scheduled_posts.py`,
`test_facebook_comments.py`, `test_facebook_stories.py`,
`test_facebook_client_resilience.py`, `test_internal_routes.py`,
`test_health.py`. Chaque défaut corrigé a un test qui documente d'abord le
comportement cassé (Jour 1) puis le comportement corrigé (Jour 2/4).

## Décisions Meta non vérifiées (à confirmer avant mise en production)

- Format exact des en-têtes de rate-limit Meta (`Retry-After` vs
  `X-Business-Use-Case-Usage`/`X-App-Usage`) pour l'app réelle.
- Version Graph API à pinner définitivement (v25.0 utilisée, à reconfirmer
  au Sprint 06/07 selon le calendrier de dépréciation Meta).

## Scénario de vérification manuelle

1. `docker compose up --build` (ou `./scripts/start.ps1`) avec
   `FACEBOOK_APP_ID`/`FACEBOOK_PAGE_ID`/`FACEBOOK_PAGE_ACCESS_TOKEN`
   renseignés dans `.env` (dev Meta) → `GET :8000/ready` doit répondre `200`.
2. Sans JWT : `curl -X POST :8000/internal/v1/comments/sync -d '{"provider":"facebook"}'`
   → `401 authentication_required`.
3. Avec un JWT de service valide (`aud=social-service`, `type=service`,
   `scope=["social:read"]`) → `200`.
4. `PUT /facebook/scheduled-posts/{id}` avec une image → `200` (avant ce
   sprint : `TypeError`).
