# Analyse concurrentielle

Un community manager suit des Pages Facebook et des comptes Instagram
professionnels concurrents, et compare leurs performances **publiques** avec
celles de sa marque. Aucune page n'est aspirée : toute la collecte passe par les
API officielles Meta, via `graph-api`.

Droits : lecture pour tous les membres de la marque, ajout / modification /
suppression / synchronisation à partir de COMMUNITY_MANAGER. Un concurrent
appartenant à une autre marque répond **404**, jamais 403 — même règle que pour
les marques elles-mêmes.

## 1. Ce que Meta autorise réellement

Table de référence tenue dans le code
([`graph-api/modules/competitors/capabilities.py`](../graph-api/modules/competitors/capabilities.py)),
pas seulement ici : c'est elle qui décide des champs demandés et de ceux qui
restent nuls par construction.

| Donnée | Facebook (Page concurrente) | Instagram (compte professionnel concurrent) |
|---|---|---|
| Identifiant, nom | `id`, `name` — via PPCA | `id`, `name` — via Business Discovery |
| Nom d'utilisateur | `username`, souvent absent | `username`, toujours présent (c'est la clé) |
| Photo de profil | `picture{url}` | `profile_picture_url` |
| Abonnés | `followers_count`, repli `fan_count` | `followers_count` |
| Nombre de publications | **non exposé** par Graph API | `media_count` |
| Publications publiques | `/{page}/posts` — via PPCA | `business_discovery{media}` |
| Date de publication | `created_time` | `timestamp` |
| Réactions / J'aime | `reactions.summary(total_count)` | `like_count`, absent si masqué |
| Commentaires | `comments.summary(total_count)` | `comments_count` |
| Partages | `shares{count}` | **jamais exposé** |
| Portée, impressions, enregistrements, visites de profil, démographie | **jamais** — métriques Insights, réservées aux comptes administrés | **jamais**, même raison |

Deux accès conditionnent tout :

- **Facebook** — lire une Page qu'on n'administre pas exige la feature
  **Page Public Content Access**, soumise à App Review (section 12 plus bas).
  Sans elle, Meta refuse les mêmes appels avec un code de permission : le
  concurrent passe en `PERMISSION_REQUIRED`, ce qui se répare par une App
  Review, pas par une nouvelle tentative.
- **Instagram** — le seul accès officiel est **Business Discovery**, et la
  requête part toujours du compte Instagram **de la marque** :
  `GET /{ig-user-id}?fields=business_discovery.username(<concurrent>){…}`.
  Conséquences assumées : la marque doit avoir un compte Instagram
  professionnel connecté, et le concurrent doit lui-même être un compte
  professionnel — un compte personnel est illisible et ressort `UNAVAILABLE`.

> **Vérification en direct non faite.** Aucune application Meta n'est configurée
> dans cet environnement : cette table vient de la documentation Meta en vigueur
> (Graph API v25), pas d'un appel réel. Le TODO l'exige explicitement — « ne
> jamais considérer une métrique comme disponible tant qu'elle n'a pas été testée
> avec le token et l'application Meta du projet ». Le code est donc écrit pour
> que chaque champ puisse s'avérer indisponible sans rien casser : un champ
> manquant ressort `null` et remonte dans `unavailableFields`. La liste à cocher
> le jour où un token réel existe est en fin de document.

### Traduction des refus Meta

Un refus n'est pas une panne : il dit quelque chose de durable sur le concurrent
ou sur l'application. D'où quatre statuts distincts plutôt qu'une erreur unique.

| Statut | Origine typique | Ce que fait le produit |
|---|---|---|
| `ACTIVE` | lecture réussie | collecte normale |
| `PERMISSION_REQUIRED` | codes 10 / 190 / 200 / 299, sous-code 2018233 | conserve les dernières données, attend une App Review ou une reconnexion |
| `UNAVAILABLE` | codes 21 / 110 / 803, sous-codes 33 / 2207013, HTTP 404 | conserve les dernières données, re-teste beaucoup plus rarement |
| `SYNC_ERROR` | 429, codes 4 / 17 / 32 / 613, 5xx, timeout, code inconnu | retente au prochain balayage |

Un code inconnu est traité comme transitoire : mieux vaut retenter une Page
réellement disparue que condamner un concurrent sur une erreur mal lue.

## 2. Modèle de données

Trois tables, migration
[`20260916000000_competitor_analysis`](../services/api/prisma/migrations/20260916000000_competitor_analysis/migration.sql).

- **`competitors`** — un concurrent suivi par une marque. `external_id` est
  *nullable* : une Page ajoutée sans PPCA n'est pas résoluble, et le TODO demande
  d'accepter l'ajout en l'indiquant plutôt que de le refuser. L'unicité porte sur
  `(brand_id, platform, username)` en minuscules, pas sur `external_id` — deux
  `NULL` ne s'entrechoquent jamais dans un index unique PostgreSQL.
- **`competitor_metrics`** — historique **append-only**, comme `social_metrics` :
  une ligne par relevé, jamais d'`UPDATE`, jamais de suppression, y compris
  quand tout est nul (une tentative qui ne ramène rien reste un fait daté).
- **`competitor_posts`** — unicité `(competitor_id, external_post_id)`. C'est
  cette contrainte qui rend la déduplication vraie, pas la prudence du code
  appelant.

S'y ajoutent `social_accounts.followers_count` / `followers_synced_at` : sans
l'audience de la marque, son taux d'engagement et celui d'un concurrent ne se
calculeraient pas de la même façon, et la comparaison resterait définitivement
« Non disponible ».

## 3. Chaîne de collecte

```
Express  POST /competitors            → graph-api /internal/v1/competitors/profile   (vérification synchrone)
         POST /competitors/:id/sync   → pg-boss                                      (202)

worker   sync-competitor          profil du concurrent + audience du compte de la marque
              ↓
         sync-competitor-posts    publications publiques, upsert dédupliqué
              ↓
         sync-competitor-metrics  relevé agrégé, recalculé depuis la base
```

Trois files plutôt qu'une : une erreur sur la pagination des publications ne
rejoue pas l'appel de profil déjà réussi, et le relevé agrégé se recalcule sans
redemander quoi que ce soit à Meta.

Répartition des écritures, différente des sprints 08/12 et assumée : **le worker
écrit**, graph-api reste sans état. Il n'y a pas de table concurrents côté
graph-api, et c'est le worker qui possède l'enchaînement des trois étapes et les
règles de déduplication ; graph-api reste ce qu'il est partout ailleurs — la
seule porte vers Meta.

Les routes `/internal/v1/competitors/*` répondent **200 même quand Meta refuse**,
le refus étant porté par `status`. Seules les erreurs d'infrastructure (compte
social introuvable → 404, aucun token actif → 409, scope manquant → 403) restent
des erreurs HTTP. C'est ce qui permet au worker de persister « ce concurrent
n'est plus lisible » comme un fait, au lieu de le retenter indéfiniment.

Rythme : balayage à 4 h et 16 h. Beaucoup plus lent que les métriques de la
marque (toutes les 30 min) — les données publiques d'un concurrent bougent
lentement, chaque concurrent coûte jusqu'à six appels Graph API, et le quota Meta
est partagé avec la publication et la synchronisation des commentaires, qui sont
critiques. Un concurrent `UNAVAILABLE` n'est re-testé qu'au bout d'une semaine,
mais n'est jamais abandonné : il peut redevenir lisible.

## 4. Indicateurs et comparabilité

Calcul dans [`services/api/src/competitors/indicators.js`](../services/api/src/competitors/indicators.js),
module pur, sans accès Prisma.

Par concurrent, sur 7 / 30 / 90 jours : nombre de publications, fréquence
hebdomadaire, réactions / commentaires / partages / interactions moyens par
publication, taux d'engagement, évolution face à la période précédente,
publication la plus performante, jour et heure de publication les plus fréquents.

**Taux d'engagement = interactions moyennes par publication ÷ abonnés × 100.**
Cette définition est *différente* de celle du Sprint 12
(`interactions / portée`, [`lib/socialMetrics.js`](../services/api/src/lib/socialMetrics.js)) :
la portée n'existe jamais pour un concurrent. Les deux ne sont jamais affichées
sous le même nom, et aucune comparaison ne mélange les deux formules.

Deux règles gouvernent l'affichage :

1. **Jamais de zéro fabriqué.** Une métrique absente vaut `null` /
   `unavailable`. Une moyenne calculée sur une partie seulement des publications
   est marquée `partial`, et l'écran écrit « Réactions / publication (sur 12) »
   plutôt que de laisser croire à un chiffre complet.
2. **Jamais deux métriques calculées différemment.** Avant tout écart,
   `commonComponents()` réduit les interactions aux composantes disponibles **des
   deux côtés**. Comparer un total Facebook incluant les partages à un total
   Instagram qui n'en a pas fabriquerait un écart qui ne mesure rien. L'exclusion
   est dite explicitement : « Interactions comparées hors partages ».

Une métrique manquante d'un côté n'est pas retirée du tableau : elle reste une
ligne, marquée « Non disponible ». Masquer la ligne ferait croire que la
comparaison est complète.

Un écart n'est calculé que si les deux valeurs existent et que la référence n'est
pas nulle — pas de « +100 % » fabriqué à partir de rien. L'orientation est fixée
une fois pour toutes : positif = la marque fait mieux que le concurrent.

## 5. Endpoints

| Méthode | Route | Rôle minimum |
|---|---|---|
| `GET` | `/api/v1/competitors?brandId&platform&status&page&pageSize` | VIEWER |
| `POST` | `/api/v1/competitors` | COMMUNITY_MANAGER |
| `POST` | `/api/v1/competitors/verify` | COMMUNITY_MANAGER |
| `GET` | `/api/v1/competitors/comparison?brandId&period&platform&limit` | VIEWER |
| `POST` | `/api/v1/competitors/comparison/explain` | VIEWER |
| `GET` | `/api/v1/competitors/:id?brandId` | VIEWER |
| `PATCH` | `/api/v1/competitors/:id` | COMMUNITY_MANAGER |
| `DELETE` | `/api/v1/competitors/:id?brandId` (204) | COMMUNITY_MANAGER |
| `POST` | `/api/v1/competitors/:id/sync` (202) | COMMUNITY_MANAGER |
| `GET` | `/api/v1/competitors/:id/posts?brandId&period&page&pageSize` | VIEWER |
| `GET` | `/api/v1/competitors/:id/analytics?brandId&period` | VIEWER |

`/comparison` est monté **avant** `/:competitorId`, sans quoi « comparison »
serait capturé comme un identifiant.

`POST /verify` interroge Meta sans rien enregistrer : c'est le bouton
« Vérifier » de l'écran d'ajout. Il répond 200 même pour un compte inaccessible —
« ce compte n'est pas analysable » est une réponse, pas une erreur. Le message
affiché est dérivé du statut, jamais le texte d'erreur de Meta, en anglais et
truffé de codes internes.

L'URL saisie est réduite à un identifiant **côté serveur et avant tout appel
réseau** (`parseCompetitorHandle`) : `facebook.com/profile.php?id=…`,
`facebook.com/pages/Nom/…`, `instagram.com/nom/`, `@nom`. Une URL d'un autre
domaine, ou un chemin qui ne désigne pas un compte (`/groups/`, `/events/`), est
refusée immédiatement avec un message exploitable plutôt qu'avec une erreur Meta
opaque après un aller-retour. Les URL raccourcies (`fb.me`) sont refusées : les
suivre depuis le serveur reviendrait à émettre une requête sortante arbitraire
fournie par l'utilisateur.

## 6. Analyse IA

`POST /api/v1/competitors/comparison/explain` → `ai-service`
`/internal/v1/analytics/competitors/explain`.

L'IA ne calcule aucun KPI. Express calcule d'abord, puis n'envoie que des
métriques déjà calculées. Deux garde-fous, pas un seul :

- Une métrique indisponible **n'est pas transmise à `null`, elle n'est pas
  transmise du tout** — seulement son libellé, dans `unavailableMetrics`. Le
  modèle ne peut pas commenter ce qu'il ne voit pas.
- La sortie du modèle traverse `_validate_numbers` : tout nombre du texte absent
  des faits transmis fait **rejeter la réponse** au profit du gabarit local. Une
  relecture humaine ne distinguerait pas un écart de 23 % réel d'un 24 %
  halluciné ; ce contrôle, si.

Au plus trois recommandations, plafond appliqué à la génération et pas seulement
déclaré. Sans modèle configuré, le gabarit local reformule les mêmes chiffres et
le mobile indique la provenance. Les valeurs ayant servi à l'analyse sont
renvoyées dans `facts`, pour que l'explication reste vérifiable après coup. Un
échantillon faible (moins de cinq publications d'un côté) produit un
avertissement explicite.

## 7. Écrans

- `/competitors` — liste, filtre par réseau, statut, dernière synchronisation,
  boutons Synchroniser et Supprimer. Un concurrent inaccessible **reste listé** :
  cacher la ligne ferait disparaître l'explication avec elle.
- `/competitors/new` — réseau, URL ou nom d'utilisateur, **Vérifier** puis
  **Ajouter**, en deux temps volontairement séparés. Enchaîner les deux
  masquerait ce que Meta autorise réellement pour ce compte.
- `/competitors/[id]` — profil, indicateurs, rythme de publication, évolution des
  relevés, publications récentes et top publications.
- `/analytics/competitors` — filtres réseau et période, tableau comparatif par
  concurrent, barres marque / concurrent, écarts en %, et l'analyse IA à la
  demande. Accessible aussi depuis l'onglet Analytics.

Un `202` est annoncé comme tel : « Synchronisation demandée. Les données seront
mises à jour sous peu. » — jamais comme un rafraîchissement immédiat.

## 8. App Review Meta

Nécessaire pour Facebook (Page Public Content Access) et pour les permissions
Instagram de Business Discovery (`instagram_basic` / `instagram_business_basic`,
`pages_read_engagement`, `instagram_manage_insights` — à confirmer sur l'écran de
consentement de l'application au moment de la soumission).

À préparer :

- le cas d'usage : un community manager compare ses performances publiques à
  celles de concurrents qu'il désigne lui-même ;
- un compte de démonstration avec une marque, un compte social connecté et au
  moins un concurrent de chaque réseau ;
- un screencast montrant l'ajout d'un concurrent (y compris l'étape
  « Vérifier »), la récupération des données autorisées, l'affichage des
  analytics et la finalité de la donnée ;
- l'argument, vrai et vérifiable dans le code : Hootly n'analyse que des
  informations accessibles légalement via l'API, ne stocke aucun contenu
  nominatif de tiers (seuls les **totaux** de réactions et commentaires sont
  lus, jamais le détail des auteurs), et ne demande aucune permission au-delà de
  celles réellement utilisées.

## 9. Vérification

```bash
# Depuis la racine
node --test services/api/test/competitors.test.js        # 22 tests
node --test services/worker/test/competitor-sync.test.js # 14 tests
npm --prefix social-media run typecheck
npm --prefix social-media run lint

# Depuis graph-api (venv activé)
python -m pytest tests/test_competitors.py

# Depuis services/ai-service (venv activé)
python -m pytest tests/test_competitor_explainer.py
```

Ce qui est couvert : résolution d'URL et de nom d'utilisateur, règle
null-vs-zéro, moyennes partielles, restriction aux composantes communes,
métriques indisponibles conservées comme lignes, déduplication des publications
et mise à jour des seules métriques modifiées, historique jamais réécrit,
conservation des données connues après un refus Meta, classement des quatre
statuts, lot partiel conservé après un refus en cours de pagination, rejet des
chiffres inventés par le modèle.

### État de la validation (16 septembre 2026)

- **Passés ici** : 22 tests API, 14 tests worker, `typecheck` et `lint` mobiles,
  ainsi que les suites existantes (171 tests API, 53 worker) — sans régression.
- **Non exécutés ici** : `pytest` de `graph-api` et de `services/ai-service`. Les
  dépendances natives de ces deux venvs (`psycopg_binary`, `scipy`) sont bloquées
  par une stratégie de contrôle d'application Windows sur cette machine, ce qui
  fait échouer **toutes** les suites Python à l'import, y compris celles
  antérieures à cette fonctionnalité. Les deux nouveaux fichiers de test ont été
  écrits pour ces suites et tourneront en conteneur ; la logique qu'ils couvrent
  (mappage des champs Meta, pagination imbriquée Business Discovery, classement
  des refus, rejet des chiffres inventés) a été vérifiée séparément en important
  les modules concernés hors `conftest.py`.
- **Non vérifié en direct** : tout ce qui touche Meta. Aucune application Meta
  n'est configurée ici, et la migration n'a pas été appliquée sur une base réelle.

### À cocher avec un token Meta réel

1. Une Page concurrente répond-elle avec PPCA, et sur quels champs exactement ?
2. `followers_count` est-il rendu sur les Pages visées, ou seulement `fan_count` ?
3. Business Discovery rend-il `media` avec `paging.cursors.after` dans la forme
   attendue, et sur combien de pages ?
4. Quel code et quel sous-code Meta renvoie-t-il précisément pour un compte
   personnel, un compte supprimé et une permission manquante ? Ajuster
   `capabilities.py` si la table diverge.
5. Quelles limites de débit s'appliquent à ces edges, et le rythme de deux
   balayages par jour les respecte-t-il pour le nombre de concurrents visé ?
