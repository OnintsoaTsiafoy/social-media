# Sprint 09 — Dataset NLP, analyse et persistance des verdicts

Cette livraison applique la tranche Sprint 09 du plan
(`sprint_listing/SPRINT_09_NLP_DATASET_ANALYSE.md`) : un dataset francophone
annoté et versionné, deux classifieurs entraînés de façon reproductible, des
règles d'urgence et de sensibilité mesurées comme le reste, et la persistance
des analyses derrière les écrans qui les attendaient depuis le Sprint 01.

`services/ai-service/` cesse d'être le stub de 31 lignes du Sprint 01 et
prend la structure de `graph-api/` (`core/`, `api/routes/`, `modules/`,
`tests/`), avec en plus `dataset/` et `training/`.

## Choix d'approche

**Modèle linéaire sur dataset maison, pas un transformeur.** TF-IDF (mots 1-2
et caractères 3-5) puis régression logistique. Les n-grammes de caractères
font l'essentiel du travail sur des commentaires sociaux : ils absorbent les
fautes (« comande »), les abréviations SMS et les accents manquants, là où des
n-grammes de mots seuls ne verraient que des tokens inconnus. Un CamemBERT
affiné aurait été plus proche de l'état de l'art mais aurait imposé une image
de ~2 Go, un téléchargement de poids à la construction et un entraînement lent
sans GPU — trois obstacles à la reproductibilité exigée par les critères
d'acceptation du sprint. Ici, l'entraînement complet prend quelques secondes
et tourne à la construction de l'image.

**Urgence et sensibilité par règles, pas par apprentissage.** Trois raisons,
détaillées dans `modules/nlp/rules.py` : trop peu d'exemples positifs (71 et
51 sur 535, un classifieur apprendrait surtout à répondre « faux ») ; un coût
d'erreur asymétrique qu'une règle permet d'arbitrer explicitement (rater une
allergie ou une mise en demeure coûte beaucoup plus qu'une fausse alerte) ; et
l'auditabilité — `signals` expose la raison exacte d'une escalade, lisible par
un community manager comme par un juriste. Ces règles sont évaluées avec les
mêmes métriques que les modèles : ne mesurer que ce qui est appris
reviendrait à livrer sans preuve la partie du système qui décide des
escalades.

**La priorité est dérivée, jamais prédite.** `compute_priority(sentiment,
intent, urgent, sensitive)` est une fonction de quelques lignes. Une priorité
apprise serait ininterprétable et changerait à chaque réentraînement ; dérivée,
elle se justifie ligne à ligne et reste stable.

## Dataset

`dataset/comments.v1.jsonl` — **535 commentaires francophones**, tous uniques
(identifiants et textes), annotés sur quatre axes : `sentiment`, `intent`,
`urgent`, `sensitive`. `dataset/ANNOTATION_GUIDE.md` est la définition de
référence des classes et des arbitrages ; toute modification du guide impose
une nouvelle version du dataset.

| Axe | Répartition |
|---|---|
| sentiment | neutral 215, negative 176, positive 144 |
| intent | other 142, info_request 141, claim 91, complaint 89, question 72 |
| urgent | 71 vrais |
| sensitive | 51 vrais |

La taxonomie n'a pas été inventée pour ce sprint : elle est **imposée par le
type `AiAnalysis`** déjà défini côté mobile (`social-media/src/types/index.ts`)
et par les écrans 18/19 livrés au Sprint 01. Une seule vocabulaire de bout en
bout — minuscules sur le fil, majuscules dans les énumérations Prisma, aucune
table de correspondance.

Le découpage est **recalculé, pas sauvegardé** : 70 / 15 / 15 stratifié sur le
couple (sentiment, intention), graine 42. Deux exécutions produisent donc
exactement les mêmes ensembles, et `evaluate.py` mesure bien sur des exemples
que `train.py` n'a jamais vus → **373 / 81 / 81**.

Les doublons exacts sont **refusés au chargement**, pas tolérés : un même texte
des deux côtés du découpage produit une fuite et un F1 flatteur qui ne veut
rien dire. `tests/test_training.py` rejoue ces contrôles sur le dataset livré,
donc une annotation future qui introduirait un doublon fait échouer la suite.

### Correction du guide en cours de route

Le guide d'annotation initial définissait l'urgence par cinq critères
(menace juridique, menace publique, relance, échéance datée, incident de
santé). Mesuré sur l'ensemble de développement, le rappel plafonnait à
**0,50** : les annotations réelles marquaient couramment comme urgents des cas
que la définition ne couvrait pas — un blocage opérationnel en cours (site en
panne, compte piraté), une attente citée de plusieurs mois, un prélèvement à
tort, un incident de discrimination. C'était **le guide qui était incomplet,
pas les annotations** : il a été élargi et les lexiques avec, ce qui a porté le
rappel à 0,98 sur le développement. Les ajouts sont marqués comme tels dans le
guide.

Deux distinctions ont dû être introduites au passage, toutes deux visibles
dans les signaux exposés :

- **incident de santé vs contexte de santé.** « J'ai dû aller aux urgences »
  est urgent et sensible ; « est-ce que la crème convient aux femmes
  enceintes ? » est sensible (relecture humaine) mais **pas** urgent. Les
  confondre envoyait toutes les questions d'allergène en tête de file.
- **fraude nommée vs pratique commerciale contestée.** « C'est de l'arnaque »
  est urgent ; « votre prix de référence a été gonflé » est sensible mais ne
  s'aggrave pas en quelques heures.

Les ajustements de lexique ont été faits **uniquement sur train+validation**.
L'ensemble de test n'a été mesuré qu'une fois, après.

## Résultats sur l'ensemble de test (81 exemples)

### Sentiment — exactitude **0,840**, F1 macro **0,849**

| Classe | Précision | Rappel | F1 | n |
|---|---|---|---|---|
| negative | 0,74 | 0,88 | 0,81 | 26 |
| neutral | 0,84 | 0,79 | 0,81 | 33 |
| positive | 1,00 | 0,86 | 0,93 | 22 |

Matrice de confusion (lignes = vérité, colonnes = prédiction, ordre
negative / neutral / positive) :

```
            neg  neu  pos
negative  [ 23    3    0 ]
neutral   [  7   26    0 ]
positive  [  1    2   19 ]
```

Aucune confusion positive ↔ negative dans un sens comme dans l'autre au-delà
d'un seul cas : les erreurs se concentrent sur la frontière neutre/négatif,
qui est aussi celle où l'annotation humaine hésite le plus (une remarque
factuelle critique).

### Intention — exactitude **0,840**, F1 macro **0,821**

| Classe | Précision | Rappel | F1 | n |
|---|---|---|---|---|
| claim | 0,72 | 0,93 | 0,81 | 14 |
| complaint | 0,83 | 0,77 | 0,80 | 13 |
| info_request | 0,83 | 0,86 | 0,84 | 22 |
| other | 1,00 | 0,90 | 0,95 | 21 |
| question | 0,78 | 0,64 | 0,70 | 11 |

```
              claim  compl  info  other  quest
claim       [  13      1      0     0      0 ]
complaint   [   3     10      0     0      0 ]
info_request[   1      1     19     0      1 ]
other       [   1      0      0    19      1 ]
question    [   0      0      4     0      7 ]
```

### Règles

| Règle | Précision | Rappel | F1 | n |
|---|---|---|---|---|
| urgent | 0,73 | **1,00** | 0,84 | 8 |
| sensitive | 1,00 | 1,00 | 1,00 | 5 |

Le compromis est volontairement asymétrique : trois fausses alertes sur 81
contre zéro urgence manquée. Sur 8 et 5 cas positifs seulement, ces chiffres
restent indicatifs (voir les limites).

### Seuils de confiance

Choisis sur la validation avec un modèle qui ne l'avait jamais vue — le
calculer avec le modèle final, réajusté sur la validation, aurait donné des
probabilités optimistes donc un seuil trop bas.

| Tâche | Seuil | Exactitude au-dessus du seuil | Couverture |
|---|---|---|---|
| sentiment | 0,50 | 0,879 | 81,5 % |
| intent | 0,45 | 0,871 | 76,5 % |

`lowConfidence` est vrai dès qu'une des deux tâches passe sous son seuil, ou
si le texte n'est pas en français. L'écran 18 affiche alors un encart
« Analyse peu fiable » au lieu de présenter le verdict comme les autres —
c'est la réponse au critère « un faible score est identifiable ».

## Erreurs connues, documentées

- **`question` est la classe la plus faible (F1 0,70).** Quatre questions de
  test sur onze sont classées `info_request`. La frontière est réelle mais
  fine (« vous fabriquez où ? » contre « c'est disponible en 42 ? ») et
  `question` est aussi la classe la moins représentée (72 exemples). C'est la
  première classe à renforcer dans un dataset v2.
- **Textes longs, intention : 0,70 d'exactitude** (contre 0,84 en moyenne).
  Un message long contient souvent plusieurs intentions et l'annotation n'en
  garde qu'une, la plus engageante ; le modèle, lui, voit les deux.
- **`claim` sur-prédit** (précision 0,72) : trois `complaint` classées
  `claim`. L'erreur va dans le sens prudent — ouvrir un dossier à tort plutôt
  que manquer une réclamation.
- **Sarcasme et ironie** restent la source d'erreur assumée : le guide les
  annote comme négatifs quand ils sont lisibles sans contexte, mais le modèle
  n'a que le texte du commentaire, jamais la publication à laquelle il répond.
- **Support faible sur les règles** (8 urgent, 5 sensitive dans le test) : ces
  F1 sont des indications, pas des garanties. Les chiffres sur
  train+validation (urgent 0,87/0,98, sensitive 0,93/0,89, sur 63 et 46 cas)
  donnent une image plus stable, mais ce sont les données ayant servi à
  régler les lexiques.
- **Une seule langue.** Le dataset est exclusivement francophone. Un
  commentaire anglais ou espagnol est détecté comme hors périmètre et marqué
  `lowConfidence`, avec la mention explicite dans l'explication — plutôt que
  classé au hasard avec une confiance trompeuse. La détection est volontairement
  prudente : en cas de doute elle répond « français », un faux négatif coûtant
  plus cher qu'un faux positif.

## Architecture retenue

### Un service sans état

`ai-service` **ne connaît pas la base de données**. Il reçoit un texte, rend un
verdict, n'écrit rien. C'est la différence assumée avec `graph-api`, qui
possède les données Meta et les persiste lui-même : ici il n'y a aucune donnée
à posséder, seulement un calcul. Ce sont donc les appelants qui stockent.

Les modèles sont chargés **une fois par processus** (singleton protégé par un
verrou : uvicorn sert les routes synchrones dans un pool de threads, deux
chargements concurrents au premier appel seraient sinon possibles). `/ready`
tente ce chargement, ce qui en fait aussi le préchauffage.

`preprocessor=normalise` est passé au vectoriseur, donc la référence vers
`modules.nlp.preprocessing.normalise` est **sérialisée dans l'artefact** : le
service ne *peut pas* normaliser autrement que ce qui a été appris. C'est une
garantie structurelle de parité entraînement/inférence, pas une convention.

### Deux normalisations, volontairement

Découvert en mesurant : les règles recevaient le texte normalisé pour le ML,
où la gestion de la négation transforme « toujours pas » en « neg_toujours
neg_pas » et les nombres en marqueurs. **La moitié des lexiques était
silencieusement neutralisée**, sans qu'aucune erreur ne soit levée.
`normalise_for_rules()` fait donc une normalisation légère (casse, accents,
apostrophes typographiques, données personnelles) en gardant ponctuation,
nombres et ordre des mots ; `match_signals()` l'applique lui-même à partir du
texte brut, pour qu'un appelant ne puisse plus se tromper. Un test verrouille
la distinction.

### Persistance : append-only plus pointeur

Migration `20260913000000_comment_analyses` :

| Objet | Rôle |
|---|---|
| `comment_analyses` | Une ligne par passage du modèle. « Réanalyser » **ajoute**, n'écrase pas : l'historique du commentaire affiche chaque analyse, et on sait après un réentraînement quelle version du modèle a produit un verdict donné. |
| `social_comments.latest_analysis_id` | Pointeur de cache vers la dernière ligne. Aucune valeur d'analyse n'est recopiée : seule l'identité l'est. |

Le pointeur existe pour une raison mesurable : filtrer une boîte de réception
par sentiment ou compter les prioritaires devient une jointure sur une ligne
unique au lieu d'une sous-requête « la plus récente par commentaire », que
Prisma n'exprime pas sans SQL brut. L'invariant est que l'insertion et la mise
à jour du pointeur sont dans **la même transaction** — côté worker, dans un
seul énoncé SQL grâce à un CTE, même idiome que les réclamations
conditionnelles de `delivery.js`. Sans ça, un arrêt entre les deux écritures
laisserait une analyse orpheline, invisible et jamais reprise.

Deux écrivains, comme `PublicationTarget.status` depuis le Sprint 04 :
Express (bouton « Analyser ») et le worker (passe automatique).

### Déclenchement automatique par balayage

Le sprint demandait un job `analyze-comment`. Il est implémenté comme un
**balayage périodique** (`analyze-social-comments`, toutes les 5 minutes) et
non comme un job produit à la réception d'un commentaire : les commentaires
arrivent par le webhook Meta, reçu par `graph-api`, qui n'est pas producteur
pg-boss (il écrit directement en base, cf. Sprint 08). Lui faire produire un
job l'obligerait à connaître la file — un couplage qu'aucun des deux sprints
n'a besoin d'introduire. Le balayage reprend simplement ce qui n'a pas encore
d'analyse, ce qui rattrape indifféremment un webhook et la synchronisation de
secours, et rend un service IA temporairement indisponible sans conséquence
durable (le commentaire ressort au balayage suivant).

### Audience de JWT distincte

`ai-service` vérifie l'audience **`ai-service`**, pas `social-service`. Le
secret de signature est le même, le périmètre non : un jeton émis pour publier
chez Meta ne doit pas ouvrir l'analyse, et réciproquement. `mintServiceJwt()`
prend donc un paramètre d'audience côté Express comme côté worker (défaut
inchangé, `social-service`). Deux tests verrouillent le fait qu'un jeton émis
pour l'un est refusé par l'autre.

## API Express

| Route | Rôle |
|---|---|
| `POST /api/v1/comments/{id}/analyze` | Analyse à la demande. Synchrone : le modèle est linéaire, l'écran affiche le résultat directement. 400 si le commentaire n'a aucun texte (cas réel : un commentaire Meta réduit à une image). |
| `POST /api/v1/comments/{id}/reanalyze` | Même fonction, même effet. Route distincte pour que l'audit distingue les deux intentions ; une seule implémentation pour qu'elles ne puissent pas diverger. |
| `GET /api/v1/comments` | Les filtres `sentiment`/`intent`/`priority` et `sort=priority` sont désormais réellement appliqués (ils étaient supprimés côté mobile au Sprint 08). |
| `GET /api/v1/comments/counts` | `highPriority` devient réel : commentaires **encore à traiter** dont la dernière analyse est « high ». `pendingAiResponses` reste à 0 — rien ne le produit avant le Sprint 10. |
| `GET /api/v1/comments/{id}/history` | Ajoute les entrées `ai_analysis`, genre prévu côté mobile depuis le Sprint 01 sans source jusqu'ici. |

Un filtre d'analyse exclut naturellement les commentaires non analysés : « montre-moi
les négatifs » ne peut pas inclure des commentaires dont le sentiment est
inconnu. C'est délibéré, pas un effet de bord.

### Correctif adjacent

`baseUrl()` était appelé **à l'intérieur** du `try` de `socialServiceClient.js` :
l'erreur de configuration (`SOCIAL_SERVICE_URL` absente) était réécrite par le
`catch` en « le service social est injoignable ». Les deux cas partageant le
même code d'erreur, rien ne le signalait. Trouvé en écrivant
`aiServiceClient.js`, où les deux codes diffèrent — et corrigé dans les deux.

## Mobile

Aucun écran recréé. `commentsApi.analyse()` passe de fixture à appel réel et
prend une option `reanalysis`, l'écran 18 la renseigne selon qu'une analyse
existe déjà. Les filtres d'analyse de la boîte de réception existaient déjà
dans l'interface (écran 17) : ils sont simplement transmis au serveur au lieu
d'être supprimés. `AiAnalysis` gagne `lowConfidence`, rendu par un encart
d'avertissement sur l'écran 18.

Restent des fixtures, hors périmètre (Sprint 10) : `generateResponse`,
`saveResponse`, `rejectResponse`, et les hashtags.

## Tests

`services/ai-service` : **76 tests** — prétraitement (substitutions, portée de
la négation, emojis, parité des deux normalisations), règles (chaque signal,
seuil d'attente, garde d'ancienneté client, incident vs contexte de santé,
dérivation de la priorité), langue, intégrité et reproductibilité du dataset,
et les routes internes (scénario nominal, paramètres invalides, sans
authentification, jeton d'une autre audience, jeton utilisateur, jeton expiré,
mauvais secret, scope manquant, service non configuré, modèles absents).
Les modèles sont **réellement entraînés** par une fixture de session : un faux
artefact cesserait de vérifier la parité entraînement/inférence.

`services/api` : **63 tests** (+12), dont `ai-service-client.test.js` (audience,
traduction des codes, service injoignable, URL absente) et les nouveaux
schémas de filtres. `services/worker` : **33 tests** (+6), dont
`comment-analysis.test.js` (pointeur renseigné, commentaire déjà analysé
jamais repris, texte vide ou supprimé ignoré, échec isolé, majuscules Prisma,
limite de lot). Mobile : `tsc --noEmit` et `expo lint` verts.

## Scénario de vérification manuelle

1. `python -m training.train` puis `python -m training.evaluate` depuis
   `services/ai-service/` : artefacts et `metrics.json` régénérés, chiffres
   identiques à ceux de ce document (graine fixe).
2. `docker compose up --build` : l'image `ai-service` entraîne les modèles à
   la construction ; `/health` répond 200 sans configuration, `/ready`
   répond 200 une fois les artefacts présents et 503 (`model_artifacts_missing`)
   si on les supprime.
3. `POST /internal/v1/comments/analyze` avec un JWT de service valide sur un
   commentaire de réclamation : `priority: high`, `urgent: true`, signaux et
   termes déterminants cohérents. Même appel avec un jeton d'audience
   `social-service` : 401.
4. Depuis le mobile, écran 18 : « Analyser » renseigne la carte d'analyse,
   « Réanalyser » ajoute une entrée d'historique sans effacer la précédente ;
   l'écran 17 filtre par sentiment et trie par priorité ; le compteur
   « prioritaires » de l'accueil reflète les analyses réelles.
5. Service d'analyse arrêté : l'action « Analyser » affiche « Le service IA est
   indisponible. Réessayez ou saisissez le texte manuellement. » (code
   `ai_unavailable`), et le balayage du worker se contente de journaliser
   l'échec — les commentaires sont repris au cycle suivant.

## Hors périmètre

Génération de réponses, safety check, hashtags et orchestration LangGraph :
Sprint 10. Réentraînement automatique, suivi de dérive du modèle et
enrichissement du dataset par les corrections des community managers : non
planifiés à ce jour.
