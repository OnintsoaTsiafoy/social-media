# Pipeline IA — détection de sentiment, notation et génération de réponse

Ce document décrit **de bout en bout** ce qui se passe entre l'arrivée d'un
commentaire Facebook et l'envoi d'une réponse validée par un humain : comment
le sentiment et l'intention sont prédits, quels scores sont calculés (et
lesquels sont appris, lesquels sont dérivés), et comment la proposition de
réponse est produite, contrôlée puis notée.

C'est une synthèse transversale ; les trois documents de livraison restent la
référence de détail : [SPRINT_09_NLP_DATASET_ANALYSE.md](SPRINT_09_NLP_DATASET_ANALYSE.md)
(dataset, métriques, limites), [SPRINT_10_LANGGRAPH_REPONSES_HASHTAGS.md](SPRINT_10_LANGGRAPH_REPONSES_HASHTAGS.md)
(graphe, cycle humain) et [RAG_FEEDBACK_HUMAIN.md](RAG_FEEDBACK_HUMAIN.md)
(base de connaissances, boucle de feedback).

## 1. Vue d'ensemble

```
Facebook ──webhook/sync──► graph-api ──écrit──► PostgreSQL (social_comments)
                                                      │
        worker (balayage, comment-analysis.js)        │  Express (bouton « Analyser »)
                        └────────────┬────────────────┘
                                     ▼
                     ai-service  POST /internal/v1/comments/analyze
                     ┌────────────────────────────────────────────┐
                     │ normalisation → TF-IDF → 2 régressions      │  (appris)
                     │ règles lexicales → urgent / sensitive       │  (non appris)
                     │ priorité dérivée + confiance + explication  │
                     └────────────────────────────────────────────┘
                                     ▼
                       comment_analyses (verdict figé, jamais écrasé)
                                     ▼
        Express POST /response-suggestions  ──► ai-service /responses/generate
                     ┌────────────────────────────────────────────┐
                     │ graphe LangGraph : validate → langue →      │
                     │ analyse → priorité → contexte → génération  │
                     │ → contrôle sécurité → action                │
                     └────────────────────────────────────────────┘
                                     ▼
                 response_suggestions (PROPOSED)  →  relecture humaine
                                     ▼
              approbation / rejet ──► ai_feedback (décision + note)
                                     ▼
              validated_response_examples ──► réinjectés comme exemples de style
```

Trois invariants structurent tout le reste :

- **Le mobile ne parle qu'à Express.** ai-service n'est joignable qu'en
  serveur-à-serveur, avec un JWT de service d'audience `ai-service` et un
  scope (`ai:analyze`, `ai:generate`, `ai:knowledge`) — voir
  [DECISIONS_ARCHITECTURE.md](DECISIONS_ARCHITECTURE.md).
- **ai-service est sans état.** Il reçoit un texte (plus, pour la génération,
  le contexte de marque déjà sélectionné par Express) et renvoie un verdict.
  Il n'ouvre jamais la base : ce sont le worker et Express qui écrivent.
- **Rien n'est publié sans approbation humaine explicite**, et cette règle est
  vérifiée côté serveur : `POST /comments/{id}/reply` n'accepte pas de texte
  libre, il publie le contenu de la proposition approuvée.

## 2. Détection de sentiment et d'intention

Code : [services/ai-service/modules/nlp/](../services/ai-service/modules/nlp/).

### 2.1 Normalisation — la même à l'entraînement et à l'inférence

[preprocessing.py](../services/ai-service/modules/nlp/preprocessing.py) expose
deux fonctions, et la distinction n'est pas cosmétique :

- `normalise()` prépare le texte **pour le modèle** : minuscules, URL / e-mail
  / téléphone / mention / hashtag / numéro de commande remplacés par des
  marqueurs (`tokurl`, `tokorder`, …), répétitions ramenées à deux caractères,
  accents retirés, emojis convertis en `emopos` / `emoneg` / `emoother`, puis
  **portée de négation** : les 3 tokens qui suivent « ne », « pas », « jamais »,
  « aucun », « sans »… sont préfixés `neg_`, la portée s'arrêtant à la
  ponctuation forte. Sans cela, « je recommande » et « je ne recommande pas »
  partagent leurs tokens les plus discriminants.
- `normalise_for_rules()` prépare le texte **pour les règles** : casse,
  accents et données personnelles uniformisés, mais ponctuation, nombres et
  ordre des mots conservés — exactement ce que la normalisation ML détruit.

La parité entraînement/inférence est garantie *structurellement* : le
`TfidfVectorizer` reçoit `preprocessor=normalise`, donc l'objet sérialisé
porte la référence vers la fonction et le service ne **peut pas** normaliser
autrement que ce qui a été appris.

### 2.2 Le classifieur

[model.py](../services/ai-service/modules/nlp/model.py) — deux modèles
indépendants, même architecture (`sentiment` et `intent`) :

```
FeatureUnion(
  TF-IDF mots       1-2 grammes,  min_df=2, sublinear_tf
  TF-IDF caractères 3-5 grammes (char_wb), min_df=2, sublinear_tf
) → LogisticRegression(C choisi sur validation, class_weight="balanced", seed 42)
```

Les n-grammes de **caractères** font l'essentiel du travail sur des
commentaires sociaux (fautes, abréviations SMS, accents manquants) ; les
n-grammes de **mots** sont gardés parce qu'eux seuls produisent une
explication lisible. `class_weight="balanced"` évite que le modèle gagne en
exactitude globale en abandonnant les classes rares (`question` est trois fois
moins représentée que `other`).

Choix assumé : **pas de transformeur**. Un CamemBERT affiné imposerait une
image de ~2 Go et un entraînement lent sans GPU, contre quelques secondes ici,
à la construction de l'image — la reproductibilité était un critère
d'acceptation du sprint.

### 2.3 Taxonomie et dataset

| Axe | Valeurs |
|---|---|
| `sentiment` | `positive`, `neutral`, `negative` |
| `intent` | `question`, `info_request`, `complaint`, `claim`, `other` |

`dataset/comments.v1.jsonl` : **535 commentaires francophones** annotés sur
quatre axes (les deux ci-dessus plus `urgent` et `sensitive`).
`dataset/ANNOTATION_GUIDE.md` est la définition de référence des classes.

Le découpage 70 / 15 / 15 (**373 / 81 / 81**) est stratifié sur le couple
(sentiment, intention) et **recalculé** à chaque exécution depuis la graine 42,
jamais sauvegardé : deux entraînements donnent les mêmes ensembles, et
`evaluate.py` mesure bien sur des exemples que `train.py` n'a jamais vus. Les
doublons exacts (identifiant ou texte) sont **refusés au chargement**, pas
tolérés — un même texte des deux côtés du découpage produit une fuite de
données et un F1 flatteur qui ne veut rien dire.

### 2.4 Garde-fou linguistique

[language.py](../services/ai-service/modules/nlp/language.py) répond
uniquement « français » ou « autre », jamais un code précis : le dataset est
exclusivement francophone, un commentaire anglais serait classé avec une
confiance arbitraire qu'aucune métrique ne signalerait. En cas de doute la
fonction répond `fr` (un faux négatif coûte plus cher qu'un faux positif), et
un texte détecté `other` force `lowConfidence` à vrai, avec la mention
explicite dans l'explication rendue au community manager.

### 2.5 Explication

`explain_terms()` lit les **coefficients réels** du modèle linéaire pour les
traits effectivement présents dans le texte, et ne garde que la branche
« mots » (un n-gramme de caractères comme « mbou » est un excellent trait mais
une explication illisible). Les marqueurs internes (`tokurl`, `neg_…`,
`emo…`) sont filtrés. C'est la vraie raison de la prédiction, pas une
justification reconstruite après coup : ces termes sont stockés dans
`comment_analyses.top_terms` et affichés à l'écran.

## 3. Notation — tous les scores du système

Le mot « note » recouvre ici **cinq mesures différentes**, calculées à des
endroits différents. Les confondre est l'erreur la plus facile à commettre en
lisant le code.

| Score | Plage | Calculé où | Sens |
|---|---|---|---|
| `sentimentConfidence` / `intentConfidence` | 0–1 | `pipeline._predict` | Probabilité de la classe prédite (`predict_proba`) |
| `confidence` | 0–1 | `pipeline.analyse` | **Minimum** des deux, jamais la moyenne |
| `confidenceScore` | 0–1 | Express, `knowledge/service.js` | Similarité cosinus du meilleur passage documentaire retrouvé |
| `rating` | 1–5 | Saisi par l'humain à l'approbation ou au rejet | Note explicite de la proposition IA |
| `editDistance` | entier | `ai-feedback/service.js` | Distance de Levenshtein entre texte généré et texte final |

### 3.1 Confiance d'analyse et seuils

La confiance globale est le **minimum** des deux tâches : une intention sûre
ne compense pas un sentiment douteux, et les deux sont de toute façon
affichées ensemble.

Les seuils ne sont pas choisis à la main. `training/train.py` parcourt une
grille (0,40 → 0,80) et retient **le plus bas seuil pour lequel le
sous-ensemble confiant atteint 85 % d'exactitude**, mesuré avec un modèle qui
n'a jamais vu la validation (le calculer avec le modèle final, réajusté sur la
validation, donnerait des probabilités optimistes, donc un seuil trop bas). Le
seuil retenu est écrit dans `artifacts/model_card.json` et relu par le service
au chargement.

| Tâche | Seuil | Exactitude au-dessus du seuil | Couverture |
|---|---|---|---|
| sentiment | 0,50 | 0,879 | 81,5 % |
| intent | 0,45 | 0,871 | 76,5 % |

`lowConfidence` est vrai dès qu'**une** des deux tâches passe sous son seuil,
**ou** si le texte n'est pas en français. L'écran affiche alors « Analyse peu
fiable » au lieu de présenter le verdict comme les autres.

### 3.2 Urgence et sensibilité — par règles, pas par apprentissage

[rules.py](../services/ai-service/modules/nlp/rules.py). Choix assumé, pour
trois raisons : trop peu d'exemples positifs (71 `urgent` et 51 `sensitive`
sur 535 — un classifieur apprendrait surtout à répondre « faux ») ; un coût
d'erreur asymétrique qu'une règle permet d'arbitrer explicitement (rater une
allergie ou une mise en demeure coûte infiniment plus qu'une fausse alerte) ;
et l'auditabilité — `signals` expose la raison exacte d'une escalade, lisible
par un community manager comme par un juriste.

Quatorze lexiques, écrits sans accent et comparés sur le texte désaccentué :
`legal`, `public_threat`, `no_answer`, `deadline`, `outage`, `billing`,
`health_incident`, `health_context`, `personal_data`, `minor`,
`discrimination`, `exclusion`, `fraud`, `unfair_practice`. S'y ajoute
`long_wait`, qui n'est pas un mot-clé mais **un calcul** : une durée citée
(« depuis 3 mois », « au bout de deux semaines ») est convertie en jours et
déclenche au-delà de 14 jours — sauf si une tournure d'ancienneté client
(« cliente depuis 10 ans ») annule le signal.

Deux distinctions introduites après mesure, visibles dans les signaux :

- **incident de santé** (urgent *et* sensible) contre **contexte de santé**
  (sensible seulement) : « j'ai dû aller aux urgences » contre « est-ce que la
  crème convient aux femmes enceintes ? » ;
- **fraude nommée** (urgent) contre **pratique commerciale contestée**
  (sensible) : « c'est de l'arnaque » contre « votre prix de référence a été
  gonflé ».

Ces règles sont **évaluées comme le reste** par `training/evaluate.py`
(précision, rappel, F1 contre les annotations) : ne mesurer que ce qui est
appris reviendrait à livrer sans preuve la partie du système qui décide des
escalades. Sur l'ensemble de test : `urgent` 0,73 / **1,00** / 0,84 (n = 8),
`sensitive` 1,00 / 1,00 / 1,00 (n = 5) — compromis volontairement asymétrique,
trois fausses alertes contre zéro urgence manquée, sur des supports faibles
qui rendent ces chiffres indicatifs.

### 3.3 Priorité — dérivée, jamais prédite

```
urgent ou sensible                             → high
sentiment négatif ET intention claim           → high
sentiment négatif OU intention claim/complaint → medium
sinon                                          → low
```

Une priorité apprise serait ininterprétable et changerait à chaque
réentraînement ; dérivée, elle se justifie ligne à ligne et reste stable.
`recommend_action()` suit la même logique : sensible → relecture par un
responsable, urgent → traiter aujourd'hui, sinon action par intention.

### 3.4 Score documentaire (RAG)

Côté Express, [knowledge/service.js](../services/api/src/knowledge/service.js)
encode le commentaire avec `intfloat/multilingual-e5-small` (384 dimensions,
préfixes `query:` et `passage:`) et cherche les passages de la marque par
distance cosinus, en **recherche exacte sur le sous-ensemble autorisé** (un
post-filtrage HNSW peut perdre des résultats d'un locataire). Le seuil
`RAG_MIN_SIMILARITY` vaut 0,86 par défaut ; les 5 meilleurs passages sont
transmis au générateur et **le score du meilleur devient `confidenceScore`**,
stocké sur la proposition et affiché dans l'éditeur de réponse. Aucun passage
au-dessus du seuil ⇒ aucune source ⇒ la génération répond « validation humaine
nécessaire » et la proposition est bloquée.

### 3.5 Note humaine et boucle de feedback

À l'approbation ou au rejet, le community manager peut joindre une note de
**1 à 5**, un motif et un commentaire libre
([schemas.js](../services/api/src/response-suggestions/schemas.js)). Une ligne
`ai_feedback` est écrite — **une seule décision terminale par génération**,
contrainte par l'unicité sur `response_id` ; une deuxième décision renvoie
`409 conflict`.

| Décision | Quand |
|---|---|
| `ACCEPTED` | approuvée sans modification du texte généré |
| `EDITED` | approuvée après réécriture |
| `REJECTED` | rejetée explicitement |
| `REGENERATED` | une nouvelle génération a été demandée avant toute décision |

`editDistance` (Levenshtein entre le texte généré et le texte final) mesure
l'effort de réécriture : une note implicite, qui ne dépend pas du fait que
l'utilisateur ait pensé à noter. `GET /ai/feedback/stats` agrège le tout par
marque — taux d'acceptation, d'édition, de rejet, confiance moyenne, distance
d'édition moyenne, durée moyenne, **note moyenne**, répartition par sentiment,
intention et stratégie. `GET /ai/feedback/dataset` exporte le corpus
commentaire / réponse IA / réponse finale / décision, qui est la matière d'un
futur dataset v2.

Une réponse `ACCEPTED` ou `EDITED` crée en plus un
`validated_response_examples` (commentaire, réponse finale, analyse), indexé
par embedding et **réinjecté comme exemple de style** dans les générations
suivantes de la même marque : c'est la boucle d'amélioration, et elle ne passe
par aucun réentraînement de modèle.

## 4. Génération de réponse

Code : [modules/workflow/](../services/ai-service/modules/workflow/),
[modules/generation/](../services/ai-service/modules/generation/),
[modules/safety/](../services/ai-service/modules/safety/).

### 4.1 Le graphe LangGraph

```
validate ──(commentaire vide)───────────────► decide_action ► FIN
    │
    └─► resolve_language ► analyse ► prioritise ► build_context
                                                       │
                                                       ▼
                                   generate ──(échec)──► decide_action ► FIN
                                       │
                                       └──► safety ► decide_action ► FIN
```

Huit nœuds, deux branches conditionnelles. Chaque nœud est une **fonction pure
de l'état vers un fragment d'état**, testable isolément sans construire le
graphe. **Aucun nœud ne lève** : une erreur est écrite dans `errors` et le
graphe décide de la suite — une exception traversant LangGraph ferait perdre
l'état partiel, donc la raison de l'échec. `decide_action` est le **seul point
de sortie** : quel que soit le chemin, l'appelant reçoit un état complet.

| Nœud | Rôle |
|---|---|
| `validate` | Refuse le vide ; **tronque** au lieu de refuser un commentaire trop long |
| `resolve_language` | Langue de la **réponse** : demandée par le CM > langue de la marque > `fr`. La langue détectée du commentaire ne décide pas (ce serait un choix éditorial que la marque n'a pas fait), elle produit seulement un avertissement |
| `analyse` | Réutilise le pipeline du §2, jamais une seconde implémentation ; un échec dégrade en proposition générique plutôt que de casser l'écran |
| `prioritise` | Remonte la priorité et ajoute les avertissements `sensitive_topic` et `low_confidence_analysis` |
| `build_context` | Résumé **lisible** de ce que le générateur a eu sous les yeux, renvoyé à l'appelant pour vérifier après coup qu'aucun historique de trop n'y est entré |
| `generate` | Appelle le fournisseur (§4.3) |
| `safety` | Contrôle le texte produit (§4.5) |
| `decide_action` | `failed` / `blocked` / `escalate` / `propose` — **jamais un envoi** |

### 4.2 Ce qu'Express assemble avant d'appeler

[response-suggestions/service.js](../services/api/src/response-suggestions/service.js) :

- **contexte de marque** — dernière version de `brand_ai_settings` (ton,
  formalité, langue, emojis, longueur visée, salutation, clôture, termes
  interdits et recommandés, consignes générales / mécontentement / urgence /
  support). Une marque sans réglages reste utilisable : le service applique
  alors ses propres valeurs par défaut ;
- **publication** d'origine, tronquée à 600 caractères — l'accroche situe le
  commentaire, une publication longue ferait dériver la réponse vers son
  contenu ;
- **historique** : au plus 5 échanges, et **uniquement des réponses réellement
  envoyées** (`status = SENT`) — un brouillon rejeté ne doit jamais ressembler
  à une réponse passée de la marque ;
- **documents** et **exemples validés**, selon la stratégie.

Trois stratégies, `rag_feedback` par défaut :

| Stratégie | Documents | Exemples validés |
|---|---|---|
| `llm` | non | non |
| `rag` | oui | non |
| `rag_feedback` | oui | oui (3 au plus) |

### 4.3 Fournisseur : Claude, avec repli local

[provider.py](../services/ai-service/modules/generation/provider.py) choisit :

1. **Claude** si `AI_GENERATION_MODE=llm` et qu'une `ANTHROPIC_API_KEY` est
   configurée (modèle par défaut `claude-opus-5`, `max_tokens` 1024, effort
   faible — rédiger deux phrases conformes à une charte est une tâche simple
   et le community manager attend devant son écran) ;
2. **repli local** sinon, ou si l'appel échoue : `local-template-1.0.0`
   compose des fragments déterministes à partir de l'analyse et des réglages
   de marque. Ce n'est pas un modèle de langue, et ses limites sont dites
   plutôt que masquées — le ton `custom`, décrit en texte libre, n'est pas
   applicable, d'où l'avertissement `custom_tone_not_applied`.

Le repli attrape `Exception`, pas seulement les erreurs prévues : le chemin
distant est justement celui dont on ne maîtrise rien. Dans tous les cas le
community manager obtient une proposition **et** un avertissement disant
laquelle des deux il a sous les yeux — jamais une substitution invisible.
`generator` et `promptVersion` remontent jusqu'en base : sans eux, impossible
de savoir plus tard d'où venait une proposition ni sous quelles consignes.

En mode RAG **sans** LLM configuré, le service ne bricole pas une réponse : il
renvoie un **extrait de source** identifié comme tel, bloqué à l'acceptation
directe.

### 4.4 Le prompt

[prompt.py](../services/ai-service/modules/generation/prompt.py), version
`comment-reply-rag-2.0.0` — toute modification du texte impose d'incrémenter
la version, qui est stockée avec chaque proposition.

Règles absolues du prompt système : produire **uniquement** le texte de la
réponse publique ; ne jamais promettre remboursement, geste commercial, délai
chiffré ni compensation ; ne jamais demander de données personnelles en
public ; n'inventer aucun fait ; n'utiliser que les faits des documents (les
exemples validés servent au **style**, ils ne prouvent jamais une politique
commerciale actuelle) ; dire qu'une validation humaine est nécessaire quand
les documents ne permettent pas de répondre.

Le message utilisateur est balisé par sections (`<contexte_marque>`,
`<documents_non_fiables>`, `<exemples_valides_style_uniquement>`,
`<analyse_automatique>`, `<publication>`, `<echanges_precedents>`,
`<commentaire_client>`, `<consigne_du_community_manager>`). **Le commentaire,
les documents et l'historique sont explicitement désignés comme des DONNÉES,
jamais des instructions** : c'est la défense contre l'injection de consigne
par un commentaire.

### 4.5 Contrôle de sécurité

[safety/checks.py](../services/ai-service/modules/safety/checks.py) s'applique
**quel que soit l'auteur du texte** — modèle distant, générateur local, ou
réécriture humaine. C'est le point important : la réécriture humaine est le
moment où un engagement non autorisé a le plus de chances d'apparaître, et
Express repasse donc par `/responses/safety-check` à chaque édition.

| Code | Sévérité | Déclenchement |
|---|---|---|
| `empty_response` | bloquant | texte vide |
| `forbidden_term` | bloquant | terme listé comme interdit par la marque |
| `unauthorised_promise` | bloquant | remboursement, garantie, délai chiffré, geste commercial |
| `personal_data` | bloquant | IBAN, carte bancaire, e-mail ou téléphone en clair, mot de passe |
| `too_long` | bloquant | plus de 500 caractères |
| `insufficient_knowledge` | bloquant | le générateur annonce un contexte insuffisant |
| `document_extract` | bloquant | extrait documentaire brut (mode RAG sans LLM) |
| `language_mismatch` | avertissement | réponse manifestement pas en français alors que `fr` est demandé |
| `emoji_not_allowed` | avertissement | emoji alors que la marque les interdit |
| `markdown_formatting` | avertissement | Facebook et Instagram n'interprètent pas le Markdown |

Deux niveaux, **un seul bloque** : un contrôle qui bloquerait trop serait
contourné, donc inutile. Une proposition `blocked` ne peut pas être approuvée
(`409 conflict`), et la vérification est refaite côté serveur à l'approbation,
pas seulement à l'affichage.

### 4.6 Cycle humain

`générer` → `modifier` (nouvelle version, rien n'est jamais écrasé) →
`régénérer` (la génération précédente est close en `REGENERATED` et passe en
`REJECTED`) → `approuver` / `rejeter` → envoi, action distincte. Chaque étape
est sérialisée par un verrou consultatif PostgreSQL sur le commentaire
(`pg_advisory_xact_lock`) et une vérification « cette version est-elle toujours
la dernière ? », ce qui rend impossible qu'un deuxième community manager
approuve une version périmée.

## 5. Persistance et endpoints

| Table | Contenu |
|---|---|
| `comment_analyses` | Un verdict par analyse : sentiment, intention, priorité, trois confiances, `low_confidence`, `is_urgent`, `is_sensitive`, langue, action recommandée, explication, `signals`, `top_terms`, `model_version`, `dataset_version`, demandeur éventuel. `social_comments.latest_analysis_id` pointe la dernière |
| `response_suggestions` | Une ligne **par version** : texte, texte généré d'origine, texte final, `generator`, `prompt_version`, `strategy`, `confidence_score`, `sources`, `similar_examples`, `analysis_snapshot`, `warnings`, `blocked`, durée |
| `ai_feedback` | Une décision terminale par génération : type, motif, **note 1–5**, commentaire, réponse finale, `edit_distance` |
| `validated_response_examples` | Commentaire, réponse validée, analyse et embedding, réinjectés comme exemples de style |
| `knowledge_documents` / `knowledge_chunks` | Base de connaissances ; passages de 480 tokens au plus avec 64 de recouvrement, `vector(384)` |

Les analyses ne sont **jamais écrasées** : réanalyser crée une ligne de plus,
et l'historique du commentaire montre la succession des verdicts.

| Endpoint | Appelant | Rôle |
|---|---|---|
| `POST /api/v1/comments/{id}/analyze` et `/reanalyze` | mobile → Express | Analyse à la demande, synchrone |
| `POST /api/v1/response-suggestions` | mobile → Express | Génère, ou enregistre une réponse rédigée à la main |
| `POST /api/v1/response-suggestions/{id}/approve`, `/reject`, `/regenerate` | mobile → Express | Décision humaine et note |
| `GET /api/v1/ai/feedback/stats` et `/dataset` | mobile, admin-web | Qualité des réponses IA |
| `POST /internal/v1/comments/analyze` | Express, worker → ai-service | Analyse d'un texte (`ai:analyze`) |
| `GET /internal/v1/models/info` | Express → ai-service | Carte du modèle servi |
| `POST /internal/v1/responses/generate` | Express → ai-service | Proposition de réponse (`ai:generate`) |
| `POST /internal/v1/workflows/comment-assistance` | Express → ai-service | Parcours complet, état entier rendu |
| `POST /internal/v1/responses/safety-check` | Express → ai-service | Contrôle d'un texte déjà rédigé |
| `POST /internal/v1/knowledge/embed` et `/prepare` | Express → ai-service | Embeddings et découpage (`ai:knowledge`) |

**Analyse automatique.** [worker/src/comment-analysis.js](../services/worker/src/comment-analysis.js)
balaie les commentaires sans `latest_analysis_id` : un community manager ne
devrait pas avoir à cliquer « Analyser » sur chaque message pour que sa boîte
de réception soit triable par priorité. Le balayage est préféré à un événement
parce que graph-api, qui reçoit le webhook Meta, n'est pas producteur pg-boss.
L'insertion de l'analyse et la mise à jour du pointeur se font dans **un seul
énoncé** (CTE) : sinon un arrêt du worker entre les deux écritures laisserait
une analyse orpheline. Trois signaux et trois seulement déclenchent une
notification — `priority = high` → `PRIORITY_COMMENT`, `sentiment = negative`
→ `NEGATIVE_COMMENT`, `urgent` → `URGENT_COMMENT`.

## 6. Reproduire, mesurer, tester

```bash
cd services/ai-service
python -m training.train      # → artifacts/{sentiment,intent}.joblib + model_card.json
python -m training.evaluate   # → artifacts/metrics.json (test, jamais touché par train)
python -m pytest -q           # dont test_rules, test_preprocessing, test_safety, test_workflow
```

Les artefacts **ne sont pas commités** : l'image Docker les produit à la
construction — quelques secondes, graine fixe, résultat identique à chaque
exécution. Sans artefacts, `/ready` répond `503 model_artifacts_missing` ; la
suite de tests, elle, entraîne sa propre copie dans un répertoire temporaire
et ne dépend donc pas d'eux.

`evaluation/` contient en plus la comparaison des trois stratégies de
génération (`compare.py`, `report.py`, résultats dans `evaluation/results/`)
et les notes humaines collectées (`results/human-ratings.csv`).

## 7. Limites connues

- **`question` est la classe la plus faible** (F1 0,70) : la frontière avec
  `info_request` est réelle mais fine (« vous fabriquez où ? » contre « c'est
  disponible en 42 ? »), et c'est la classe la moins représentée. Première à
  renforcer dans un dataset v2.
- **Textes longs** : 0,70 d'exactitude sur l'intention contre 0,84 en moyenne.
  Un message long porte souvent plusieurs intentions, l'annotation n'en garde
  qu'une.
- **Sarcasme et ironie** : erreur assumée — le modèle n'a que le texte du
  commentaire, jamais la publication à laquelle il répond.
- **Une seule langue apprise.** Hors français, l'analyse est marquée
  `lowConfidence` avec mention explicite plutôt que présentée comme fiable. Le
  générateur local ne rédige qu'en français et en anglais ; l'arabe n'est servi
  que par le LLM.
- **Supports faibles sur les règles** (8 `urgent` et 5 `sensitive` dans le
  test) : ces F1 sont des indications, pas des garanties.
- **Les commentaires historiques importés ne sont pas analysés
  rétroactivement** — ils arriveraient en masse dans la boîte de réception
  comme `NEW` (voir [SYNCHRO_PUBLICATIONS.md](SYNCHRO_PUBLICATIONS.md)).
- **Le seuil d'autonomie et l'auto-réponse par page de la console d'admin sont
  stockés mais consommés par aucun pipeline** : rien ne part sans approbation
  humaine, quelle que soit la valeur de ces réglages.
