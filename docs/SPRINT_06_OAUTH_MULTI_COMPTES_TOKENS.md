# Sprint 06 — OAuth Meta, multi-comptes, tokens sécurisés

Cette livraison applique la tranche Sprint 06 du plan
(`sprint_listing/SPRINT_06_OAUTH_MULTI_COMPTES_TOKENS.md`) : remplacer le
token Facebook global par une connexion OAuth réelle, multi-comptes,
tokens chiffrés au repos. Les écrans mobiles existants
(`app/settings/social-accounts.tsx`, `app/oauth/callback.tsx`) ont été
branchés sur l'API réelle, pas recréés.

**Décision produit** : Instagram (Sprint 07) supportera les deux parcours
OAuth Meta — compte lié à une Page Facebook (découvert automatiquement lors
d'un `connect('facebook')`) et connexion Instagram directe (Instagram
Login). Le schéma ci-dessous anticipe déjà cette distinction
(`SocialAccountAuthMethod`).

## Persistance

Migration `20260912000000_social_accounts_oauth` :

| Table | Rôle |
|---|---|
| `social_accounts` | Un compte Meta lié à une marque : `provider`, `external_account_id` (unique par provider), `status`, `auth_method`. |
| `oauth_tokens` | Tokens chiffrés (AES-256-GCM), versionnés (jamais d'UPDATE en place, comme `brand_ai_settings`) ; `encryption_key_version` pour la rotation. |
| `social_permissions` | Permissions Meta vérifiées par compte (`GRANTED`/`DECLINED`). |
| `oauth_states` | State CSRF à usage unique, hashé (jamais stocké en clair), TTL 10 min. |
| `service_idempotency_keys` | Idempotency-Key des routes `/internal/v1` sensibles, côté `graph-api`. |

`PublicationTarget.@@unique([publicationId, provider])` → `@@unique([publicationId, socialAccountId])` :
l'ancienne contrainte empêchait structurellement deux comptes du même réseau
sur une publication.

**Propriété des données** : Prisma reste seul propriétaire de la migration
(DDL). `graph-api` lit/écrit ces 5 tables en SQL brut (`psycopg`, pas
d'ORM) — exactement le pattern déjà utilisé par `services/worker` pour
`publications`/`publication_targets`. Express ne lit jamais `oauth_tokens`
directement (le texte est chiffré, la clé n'existe que côté `graph-api`).

## Sécurité des tokens

- Chiffrement AES-256-GCM (`graph-api/core/crypto.py`), clé versionnée dès
  le départ (`TOKEN_ENCRYPTION_KEY_CURRENT_VERSION`, `TOKEN_ENCRYPTION_KEY_1`)
  pour que la rotation future n'impose pas de migration de schéma.
- `oauth_states.state_hash` est un SHA-256 du state — jamais le state en
  clair. Le calcul est dupliqué à l'identique côté Express
  (`social-accounts/service.js::hashState`) et côté `graph-api`
  (`core/crypto.py::hash_state`) ; un test croisé (`test/social-accounts.test.js`)
  fige un vecteur de test Python → Node pour éviter une divergence
  silencieuse.
- Un token Meta n'atteint jamais le mobile : `app/oauth/callback.tsx` ne
  reçoit que `status`/`network`/`account`/`reason` par deep link.

## Flux OAuth (Facebook)

1. `POST /api/v1/social-accounts/facebook/connect` (Express, JWT
   utilisateur, rôle `ADMIN` minimum) → mint un JWT de service → appelle
   `POST /internal/v1/oauth/facebook/authorization-url` (`graph-api`) →
   génère un state aléatoire (`secrets.token_urlsafe`), le hash et le
   stocke, construit l'URL du dialogue Meta (scope combiné Page + Instagram,
   pour découvrir les comptes Instagram liés sans second écran de consentement).
2. Le mobile ouvre cette URL via `expo-web-browser` (`openAuthSessionAsync`),
   avec pour `redirectUri` un deep link Expo (`Linking.createURL('oauth/callback')`).
3. Meta redirige vers `GET /oauth/facebook/callback` (public, protégé par le
   state à usage unique — pas de JWT). Le callback consomme le state
   (`UPDATE ... WHERE consumed_at IS NULL ... RETURNING`, même idiome que le
   `CLAIM_TARGET` du worker), échange le code, dérive un token utilisateur
   longue durée, liste les Pages éligibles (`me/accounts`), et pour chacune :
   - crée/relie la ligne `social_accounts` (provider `FACEBOOK`) ;
   - chiffre et stocke le token de Page (qui n'expire pas tant que l'admin
     garde l'accès à la Page — vérifié dans la documentation Meta, pas supposé) ;
   - découvre un compte Instagram professionnel lié
     (`{page-id}?fields=instagram_business_account{...}`) et crée la ligne
     `social_accounts` correspondante (provider `INSTAGRAM`,
     `auth_method: FACEBOOK_PAGE`) avec le même token de Page.
4. `graph-api` redirige (HTTP 302 réel, pas seulement un corps JSON — c'est
   ce qu'`expo-web-browser` doit intercepter) vers le deep link mobile avec
   `status=success&network=facebook&account=...`.
5. Le mobile revient sur `/settings/social-accounts` et recharge la liste.

**Simplification MVP assumée** : toutes les Pages/comptes IG éligibles sont
liés automatiquement (pas d'écran de sélection) ; l'utilisateur retire ceux
qu'il ne veut pas via « Déconnecter ».

## `/internal/v1` ajoutés (JWT de service, Sprint 05)

| Route | Rôle |
|---|---|
| `POST /internal/v1/oauth/{provider}/authorization-url` | `instagram` renvoie `422 PROVIDER_NOT_SUPPORTED` avant le Sprint 07. |
| `GET /oauth/facebook/callback` | Public, protégé par le state. |
| `POST /internal/v1/social-accounts/{id}/refresh-token` | Revalide (les tokens de Page n'expirent pas activement) ; `409 REAUTHENTICATION_REQUIRED` si Meta rejette le token. |
| `GET /internal/v1/social-accounts/{id}/permissions` | `{permissions, missingRequiredPermissions}`. |
| `POST /internal/v1/social-accounts/{id}/revoke` | Local uniquement — ne révoque pas côté Meta (voir Décisions Meta ci-dessous). |

## API livrée côté Express

| Route | Rôle |
|---|---|
| `GET /api/v1/social-accounts?brandId=` | Liste, `VIEWER` minimum. |
| `POST /api/v1/social-accounts/{provider}/connect` | `ADMIN` minimum → `{authorizationUrl, oauthState}`. |
| `GET /api/v1/social-accounts/oauth/status?state=` | `PENDING`/`COMPLETED`/`EXPIRED` — secours si le retour de navigateur n'a pas été capté proprement. |
| `POST /api/v1/social-accounts/{id}/sync` | Revalide auprès de Meta (pas de sync commentaires/métriques avant les Sprints 08/12). |
| `DELETE /api/v1/social-accounts/{id}` | `ADMIN` minimum, révoque puis 204. |

## Job worker

`services/worker` : nouvelle file `refresh-expiring-oauth-tokens`, cron
quotidien (3h). Une seule requête couvre deux cas : un token qui expire
réellement bientôt (Instagram, Sprint 07) et un compte connecté jamais
revérifié depuis longtemps (Facebook aujourd'hui, dont les tokens de Page
n'ont pas de vraie expiration). Le worker appelle `graph-api` directement
(JWT de service `sub=hootly-worker`), sans passer par Express — conforme au
diagramme de topologie de `docs/DECISIONS_ARCHITECTURE.md`.

## Correction adjacente : bug pré-existant Express

Découvert en vérifiant manuellement `POST /api/v1/social-accounts/{provider}/connect`
contre la pile réelle : **tous** les endpoints `:brandId` (`brands/routes.js`)
échouaient en 500 (« next is not a function »). Cause : la signature du
callback `router.param()` d'Express est `(req, res, next, value)` — `next`
en 3ᵉ position, `value` en 4ᵉ — et le code existant les avait inversés.
Confirmé empiriquement (script Node isolé) puis corrigé dans
`brands/routes.js` et dans le nouveau `social-accounts/routes.js`, qui
reproduisait le même bug par imitation. Sans lien avec le Sprint 06 au
départ, mais bloquant sa propre vérification manuelle.

## Vocabulaire mobile aligné

`AccountStatus` (mobile) colle désormais exactement à l'enum backend
`SocialAccountStatus` (minuscule, comme `Brand.status`) plutôt que de
maintenir une table de correspondance : `expiring_soon` → `expiring`,
`reconnect_required` → `reauth_required`. `PublicationTarget.accountUsername`
n'est plus systématiquement vide : `publications/service.js` inclut
désormais le compte lié (`social_accounts.username`/`name`).

## Décisions Meta non vérifiées (à confirmer avant mise en production)

- Un token de Page dérivé d'un token utilisateur longue durée n'expire pas
  tant que l'admin garde l'accès à la Page — confirmé dans la documentation
  Meta actuelle, jamais vérifié contre une vraie App Meta de ce projet.
- **Révocation** : `revoke` ne désautorise que localement (statut
  `DISCONNECTED`/`REVOKED` côté Hootly). Le modèle de permissions Facebook
  Login est par utilisateur, pas par Page : aucun moyen vérifié de révoquer
  l'accès à une seule Page sans affecter les autres Pages liées au même
  utilisateur. À confirmer avant de promettre une révocation complète côté
  Meta dans l'UI.
- Liste exacte des scopes approuvés (App Review) — le code demande
  `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
  `pages_manage_engagement`, `business_management`,
  `instagram_business_basic`, `instagram_business_content_publish`,
  `instagram_business_manage_comments`, `instagram_business_manage_insights` ;
  certains ne servent qu'à partir du Sprint 07/08.

## Tests

`graph-api` : 104 tests (respx, aucun appel Meta réel) —
`test_oauth_authorization_url.py`, `test_oauth_callback.py`,
`test_social_account_routes.py`, `test_crypto.py` en plus des suites
Sprint 05. `services/api` : 38 tests (`social-accounts.test.js`, dont le
vecteur croisé `hashState`). `services/worker` : 16 tests
(`token-refresh.test.js`, double d'accès `pg` étendu dans `test/fake-db.js`).
Mobile : `tsc --noEmit` et `expo lint` verts ; bundle Metro web vérifié
(1434 modules, aucune erreur).

## Scénario de vérification manuelle

1. `docker compose up --build`, seed (`./scripts/seed.ps1`), se connecter en
   `lea@studio-vega.fr / ChangeMe123!`.
2. `POST /api/v1/social-accounts/facebook/connect` avec le `brandId` de
   Studio Vega → une `authorizationUrl` Facebook réelle est renvoyée, une
   ligne `oauth_states` existe en base, non consommée.
3. `GET /api/v1/social-accounts/oauth/status?state=...` → `PENDING`.
4. Sans JWT de service : tout `/internal/v1/social-accounts/...` répond
   `401`.
5. Avec de vrais identifiants Meta (hors périmètre de cette livraison) :
   suivre le lien d'autorisation, accepter, vérifier le retour sur l'écran
   mobile « Compte connecté » et la ligne `social_accounts` correspondante.
