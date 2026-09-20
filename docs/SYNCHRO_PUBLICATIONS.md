# Synchronisation des publications d'une page — état livré

Quand une page Facebook est liée à une marque, ses publications **déjà en ligne** sont importées dans la base de Hootly (synchronisation **initiale**), puis les nouveautés et les modifications récentes sont rapatriées en continu (synchronisations **incrémentales**). Sans cela, l'application ne connaissait que ce qu'elle avait elle-même publié : une page existante apparaissait vide, sans historique, sans analytics.

## 1. Principe : une publication importée est une publication

Un post présent sur la page mais absent de Hootly devient :

| Table | Ligne créée |
|---|---|
| `publications` | `status = PUBLISHED`, **`origin = IMPORTED`**, `published_at` et `created_at` = date du post sur Facebook, `content` = texte du post, `hashtags` extraits du texte, auteur = l'utilisateur au nom duquel la page est liée (`social_accounts.connected_by_user_id`) — une publication exige un auteur, et celui du post sur Facebook n'est pas connu |
| `publication_targets` | `status = SENT`, `external_publication_id` = identifiant Meta du post, **`external_url`** = son adresse Facebook, `sent_at` = date du post |
| `social_metrics` | Un premier relevé (réactions, commentaires, partages déjà renvoyés avec le post ; `reach` et `impressions` restent `null`, jamais 0) |

Ce choix évite un second modèle de données : les listes de publications, le calendrier, le tableau de bord, les analytics, l'analyse concurrentielle, la synchronisation des commentaires et celle des métriques lisent déjà `publications` / `publication_targets`, et fonctionnent donc sans autre code sur l'historique importé. Un commentaire reçu sur un post « organique » se rattache désormais à une publication locale (la limite documentée au Sprint 08 est levée pour les publications).

**Une publication importée n'est jamais renvoyée ni rééditée par Hootly.** Elle naît `PUBLISHED`, statut depuis lequel `canEditContent`, `canSchedule` et `canPublish` sont faux : `PATCH`, planification, `publish` et `retry` sont refusés (vérifié en base réelle, `posts-import.integration.test.js`). L'API expose `origin: "imported" | "hootly"` sur chaque publication et `externalUrl` sur chaque cible, pour que les clients puissent la distinguer.

## 2. Qui fait quoi

```
liaison de la page ─┐
bouton « Synchroniser » ─┼─▶ file pg-boss `sync-social-posts` ─▶ worker (posts-sync.js)
balayage (30 min) ──┘                                              │  choisit les comptes, boucle sur les curseurs
                                                                   ▼
                                       graph-api  POST /internal/v1/posts/sync
                                       lit /{page}/posts chez Meta, écrit publications / cibles / métriques
                                                                   ▼
                                                              PostgreSQL
```

Même répartition que pour les commentaires et les métriques : le **worker** ne fait que choisir les candidats (lecture SQL) et appeler graph-api ; **graph-api** lit Meta et écrit la base — seul écrivain de `last_posts_sync_at`. Express n'importe rien lui-même : il met un job en file.

### Déclencheurs

| Déclencheur | Où | Effet |
|---|---|---|
| Liaison d'une page Facebook | `admin/pageConnection.js` (`linkPageSelection`) | Un job par compte Facebook lié. Au mieux : un échec de mise en file ne fait pas échouer la liaison |
| Bouton « Synchroniser » de la console | `POST /api/v1/admin/pages/{id}/sync` → `202` | `{ status: "queued" \| "already_queued" }` ; `409` pour Instagram ou une page à reconnecter ; journalisé (`admin.page.sync_requested`) |
| « Synchroniser » du mobile | `POST /api/v1/social-accounts/{id}/sync` | En plus de la revalidation du jeton, met un import en file (au mieux) |
| Balayage périodique | worker, cron `*/30 * * * *` | Comptes Facebook connectés dont `last_posts_sync_at` est vide (d'abord) ou ancien (> 20 min), 5 par passage |

Le balayage est aussi **le filet de la synchronisation initiale** : si le job de liaison n'a pas pu partir, la page est reprise au plus tard 30 minutes plus tard.

## 3. Initiale ou incrémentale

Un seul critère, dans une seule colonne : **`social_accounts.last_posts_sync_at`**, écrite par graph-api uniquement, **à la fin** d'une passe complète (dernière page lue).

| `last_posts_sync_at` | Mode | Lecture chez Meta |
|---|---|---|
| vide | **initial** | Tout le fil, jusqu'à la dernière page (pas de `since`) |
| renseigné | **incrémental** | `since` = `last_posts_sync_at` − `POSTS_SYNC_OVERLAP_DAYS` (7 j) |

- Meta filtre `since` sur la **date de création** : les nouveaux posts sont trouvés exactement, mais une **modification de texte** sur un post plus ancien ne l'est pas. La fenêtre de recouvrement (7 jours) relit ce qui a pu changer récemment ; relire un post inchangé est sans effet (upsert).
- Le point de départ est la dernière passe **achevée**, jamais la dernière tentative : une page injoignable pendant trois semaines est rattrapée en entier, sans intervention.
- Une passe initiale **interrompue** (crash, Meta indisponible) ne note rien : la suivante repart du début, sans état à réparer. Les posts déjà écrits ne sont pas dupliqués.

### Pagination et durée d'un appel

L'historique d'une grande page ne tient pas dans une requête HTTP. Un appel à graph-api ne lit que `POSTS_SYNC_PAGES_PER_CALL` pages (3) de `POSTS_SYNC_PAGE_SIZE` posts (50) et renvoie `nextCursor` tant que `done` est faux ; le worker rappelle avec ce curseur (jusqu'à 100 appels ≈ 15 000 posts). Seul l'appel qui lit la dernière page écrit `last_posts_sync_at`. Une annonce de page suivante **sans curseur** est une erreur `502`, pas une fin : s'arrêter là ferait passer un import tronqué pour achevé.

## 4. Dédoublonnage et garanties

- **Clé unique `(social_account_id, external_publication_id)`** sur `publication_targets` (`publication_targets_account_external_key`, migration `20260920020000_facebook_posts_import`). Elle remplace l'ancien index simple de mêmes colonnes. `NULL` n'égale jamais `NULL` : brouillons et envois en cours ne sont pas concernés. Un post publié par Hootly puis relu sur le fil de la page **n'est pas dupliqué** — c'est le cas réel des deux derniers posts de la page de test.
- **Une transaction par post**, `ON CONFLICT DO NOTHING` sur cette clé : deux passes simultanées ne créent jamais deux fois le même post (la perdante annule sa transaction, publication orpheline comprise).
- **Ce qu'une relecture peut modifier** : l'adresse (`external_url`) de toute cible — c'est ainsi qu'un post publié par Hootly obtient son lien Facebook — et le texte / hashtags d'une publication **IMPORTED**. Jamais le texte d'une publication composée dans Hootly (sa version approuvée fait foi), ni son statut : une publication supprimée dans Hootly (`deleted_at`) ne « ressuscite » pas.
- **Une erreur de base fait échouer l'appel** au lieu d'être avalée : sinon une panne PostgreSQL passerait pour une synchronisation réussie, `last_posts_sync_at` serait noté et rien n'aurait été écrit. Seul un post inexploitable (sans date de création) est ignoré et compté (`skipped`).
- `reactions` / `comments` valent `null` quand Meta ne les renvoie pas (permission absente) : jamais un faux 0. `shares` fait exception — Meta omet le champ à zéro partage, l'absence est la valeur (même règle que `post_analytics_service`).

## 5. Contrats

**graph-api** — `POST /internal/v1/posts/sync`, scope `social:read` (rien n'est écrit chez Meta) :

```jsonc
// requête
{ "socialAccountId": "…", "provider": "facebook", "cursor": null }
// réponse
{ "mode": "initial" | "incremental", "created": 12, "updated": 1, "unchanged": 30, "skipped": 0,
  "nextCursor": null, "done": true }
```

`socialAccountId` est obligatoire (pas de repli sur la Page globale de l'`.env` : un post importé doit être rattaché à une marque). `provider` doit correspondre au compte (`422` sinon). Instagram répond `422 unprocessable` : le fil d'un compte Instagram (`/{ig-user-id}/media`) a ses propres champs, types et permissions, et n'est pas supposé identique à celui de Facebook.

**Réglages graph-api** (`core/config.py`) : `POSTS_SYNC_PAGE_SIZE=50`, `POSTS_SYNC_PAGES_PER_CALL=3`, `POSTS_SYNC_OVERLAP_DAYS=7`.

**Console** — `GET /api/v1/admin/pages` expose par page `lastPostsSyncAt` (`null` = historique jamais importé en entier) et `postsCount` (posts connus de Hootly, publiés par lui ou importés). L'écran Pages affiche « 42 publications · synchronisées il y a 5 minutes » (ou « Historique non importé · N publications connues ») et un bouton **Synchroniser** — Facebook uniquement, désactivé pour une page à reconnecter.

## 6. Effets sur l'existant (corrections incluses)

- **Synchronisation des commentaires** (`comment-sync.js`) : ne relit plus que les **50 posts les plus récents** de chaque compte. Une fois l'historique importé, un compte en compte des centaines, que graph-api parcourt un par un ; les relire tous toutes les 15 minutes épuiserait le quota Meta et dépasserait le délai d'attente. Les commentaires d'un post ancien ne sont pas rattrapés par ce filet (le webhook reste leur voie normale).
- **Synchronisation des métriques** (`metrics-sync.js`) : sa requête de sélection combinait `SELECT DISTINCT` et un `ORDER BY` sur une colonne absente du `SELECT`, que PostgreSQL refuse (« for SELECT DISTINCT, ORDER BY expressions must appear in select list »). **Elle échouait donc pour chaque compte depuis le Sprint 12** (constaté dans les journaux du worker : `metrics-sync … failed: 1`), sans que le double de test le voie. Corrigée (le `DISTINCT` est inutile depuis la clé unique) : les compteurs des posts récents, importés compris, se rafraîchissent désormais.
- `GET /api/v1/social-accounts` expose `lastPostsSyncAt`.

## 7. Limites connues (décisions à valider)

- **Commentaires historiques non importés.** L'import ramène les publications et leur *nombre* de commentaires, pas le texte des commentaires des posts anciens : chacun arriverait en statut `NEW` dans la boîte de réception, passerait par l'analyse IA (et ses notifications) et serait compté comme reçu à la date d'import dans les analytics (`social_comments.created_at` est la date d'insertion). Les commentaires des 50 posts les plus récents sont couverts par la synchronisation existante. Un rattrapage complet demande de décider comment traiter ces commentaires anciens (statut, notifications, date).
- **Pas de médias.** `full_picture` est une URL `fbcdn` signée qui expire ; la conserver donnerait des images cassées. Importer l'image demande de la télécharger, de l'inspecter et de la stocker dans MinIO.
- **Posts supprimés sur Facebook non détectés.** Un post qui disparaît du fil reste dans Hootly. Le détecter (comme pour les commentaires) archiverait des publications sur la foi d'un fil que Meta peut renvoyer partiel : décision à prendre.
- **Édition ancienne non détectée** : une modification de texte sur un post de plus de 7 jours (fenêtre de recouvrement) n'est pas relue.
- **Facebook seulement.** Instagram est refusé explicitement (`422`), pas importé partiellement.
- **Auteur** : `authorId` / `authorName` d'une publication importée désignent l'utilisateur qui a lié la page.
- Pas de webhook `feed` : un post publié directement sur Facebook apparaît avec 30 minutes de délai au plus.

## 8. Vérification

- graph-api : `tests/test_posts_sync.py` (17 tests : initial, incrémental, dédoublonnage d'un post publié par Hootly, édition d'un post importé, pagination bornée, garde « page suivante sans curseur », post inexploitable, erreur Meta, jeton absent, Instagram refusé, scopes). Mutations volontaires du service (fenêtre de recouvrement, garde de curseur, marquage « achevé », premier relevé) : toutes détectées.
- worker : `test/posts-sync.test.js` (balayage, boucle de curseurs, bornes, isolation des échecs, jobs ciblés) ; plafond de `comment-sync`.
- API : `test/posts-import.integration.test.js` et `admin.integration.test.js` (`POSTS_IMPORT_INTEGRATION=1` / `ADMIN_INTEGRATION=1`, base Compose réelle) : action `202`, dédoublonnage du job, journal, clé unique, gardes sur la publication importée, job d'import créé à la liaison.
- console : `src/App.test.tsx` (état de l'import, bouton, doublon, erreur, page à reconnecter).
- Les requêtes SQL du worker et la migration ont été exécutées sur la vraie base (le double du worker ne valide pas la syntaxe SQL — c'est ainsi que le bug de `metrics-sync` avait pu passer).
