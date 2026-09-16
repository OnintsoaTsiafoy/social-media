# Analytics expliqués par IA

L’écran `/analytics` conserve ses graphiques et ajoute une analyse à la demande,
un historique paginé et un avis modifiable par membre. Les droits de génération
sont COMMUNITY_MANAGER, ADMIN ou OWNER ; tous les membres peuvent lire et évaluer.

## Données et interprétation

`AnalyticsSummary` est construit par Express dans une transaction PostgreSQL
`RepeatableRead`. Les fenêtres glissantes de 7, 30 ou 90 jours sont adjacentes,
de même durée, en UTC, avec une borne de fin exclue. Le filtre réseau s’applique
aux cibles réellement envoyées et aux comptes des commentaires/réponses.

- Publications : dernières métriques connues à la date de calcul, cumulées depuis
  la publication et regroupées selon sa date de publication. **Ce ne sont pas les
  interactions reçues pendant la fenêtre.** Le pic correspond donc au groupe de
  publications d’un jour, pas à l’heure de réception des interactions.
- Engagement : `(réactions + commentaires + partages) / portée × 100` dans
  `AnalyticsSummary`. L’ancien `/summary` conserve son ratio entre unités.
- Une somme partiellement connue reste marquée `partial` ; une absence est
  `null` / `unavailable`, jamais zéro. Une portée nulle rend l’engagement absent.
  Une métrique partielle ne produit ni comparaison ni fait interprété.
- Sentiments, urgence et priorité : dernière analyse des commentaires non
  supprimés **importés** pendant la fenêtre. Si certains restent non analysés,
  la répartition est partielle ; sans analyse, elle est indisponible.
- Générations IA : toutes les propositions `generatedByAi=true` créées dans la
  fenêtre, y compris les régénérations, sans compter les versions éditées.
- Réponses IA envoyées : envois réussis terminés dans la fenêtre, rattachés à une
  suggestion `SENT` issue de l’IA ou d’une édition d’une génération IA. Une réponse
  entièrement manuelle est exclue.
- Acceptation : décisions `ACCEPTED` ou `EDITED` / toutes les décisions terminales
  des générations de la fenêtre. Sans décision, taux indisponible. Ce taux ne
  divise pas les envois de la fenêtre par des générations d’une autre période.

Les métriques des deux cohortes, leur disponibilité, les variations et leur motif
d’absence, les meilleurs posts, le réseau en tête, les dates et la synchronisation
sont conservés dans `metricsSnapshot`. Seul un réseau strictement en tête de deux
réseaux aux métriques complètes est désigné meilleur réseau.

### Règles de tendance, version initiale

- Variation relative : `(actuel − précédent) / précédent × 100`, arrondie à deux
  décimales ; jamais de pourcentage sur une référence nulle.
- Comparaison sociale : au moins trois publications par cohorte ; comparaison
  des sentiments/urgences : cinq commentaires analysés par cohorte ; réponses :
  trois générations par cohorte. Données complètes requises dans les deux cohortes.
- Hausse/baisse significative : valeur absolue d’au moins 20 %.
- Anomalie d’interactions : hausse d’au moins 200 % ou baisse d’au moins 50 %.
- Changement de sentiment : au moins dix points de part négative.
- Hausse d’urgence : au moins trois commentaires urgents supplémentaires.
- Concentration : le premier post représente au moins 40 % des interactions,
  sur au moins trois publications.
- Pic : au moins trois jours avec publications mesurées, un maximum d’au moins
  dix interactions et strictement supérieur au double de la moyenne des autres jours.

Ces règles sont des signaux descriptifs, sans prétention de significativité
statistique ou d’explication causale. L’avertissement sur les métriques cumulées
est systématiquement affiché.

## Explication vérifiable

`POST /internal/v1/analytics/explain` exige un JWT de service `ai:generate` et un
schéma Pydantic strict. Le payload contient uniquement période, réseau, métriques,
faits et avertissements. Aucun identifiant de marque/utilisateur, contenu de post,
commentaire brut, feedback humain ou token social n’est envoyé au LLM.

Le modèle choisit des **identifiants de faits** pour le résumé, les faits importants,
les points positifs, les points d’attention et au plus trois recommandations.
Les formulations de ces faits sont calculées et préparées par Express. FastAPI
effectue le rendu en français et vérifie valeurs, unités, disponibilité, polarité,
identifiants et limites. Le modèle apporte la sélection/priorisation ; aucun texte
libre du modèle ne traverse cette frontière. Express reconstruit le rendu attendu
et rejette toute différence avant enregistrement. Les avertissements sont imposés
par les données, jamais supprimés par le modèle.

Le JSON public contient `summary`, `importantFacts`, `positivePoints`,
`attentionPoints`, `recommendations`, `referencedMetrics`, `warnings`.
Délais : 18 secondes côté SDK sans réessai, 25 secondes côté Express. Si le modèle
ou FastAPI échoue, la même sélection déterministe locale fournit le résultat ;
`ai.status=fallback` l’indique. Les journaux et l’audit portent `requestId` sans
contenu sensible. Aucune nouvelle variable d’environnement : la configuration
existante `AI_SERVICE_URL`, `AI_GENERATION_MODE`, `ANTHROPIC_API_KEY` et le modèle
du service IA sont réutilisés.

## Historique et feedback

Migration : `20260915010000_analytics_insights` ajoute `AnalyticsInsight` et
`AnalyticsInsightFeedback`. Les analyses sont immuables ; régénérer crée une ligne.
L’API retourne `historical=true` pour toute consultation historique, même si la
ligne est récente. L’écran n’affiche aucune ancienne analyse comme courante lors
d’un changement de marque, de réseau ou de période. La période et la date de
génération accompagnent toujours l’analyse.

Un membre peut remplacer son vote/commentaire, sans augmenter le nombre d’avis.
Les statistiques donnent avis positifs/négatifs, taux de satisfaction (`null`
sans avis) et les cinq analyses ayant le plus d’avis négatifs. Elles couvrent
l’historique correspondant au réseau et à la durée choisis. Le feedback individuel
retourné est celui du lecteur uniquement. Les textes de feedback sont conservés
pour une future évaluation, sans envoi au LLM ni entraînement automatique.

## Vérification

```powershell
npm --prefix services/api run prisma:generate
./scripts/start.ps1
node scripts/test-analytics-integration.mjs
node services/api/test/analytics-insights.test.js
# Depuis services/ai-service (venv activé)
python -m pytest -q tests/test_analytics_insights.py
# Depuis la racine
npm --prefix social-media run typecheck
npm --prefix social-media run lint
npm --prefix social-media test
```

Les tests couvrent les neuf combinaisons de filtres, variations, anomalies,
données vides/partielles, réponses erronées ou chiffres inventés, service IA
indisponible, historique, pagination, isolation des marques et feedback idempotent.
L’intégration utilise PostgreSQL avec des fixtures isolées et aucun appel Meta/LLM réel.

### Validation réalisée le 15 septembre 2026

- API : 146 tests réussis, trois intégrations optionnelles ignorées dans la suite
  générale ; l’intégration Analytics PostgreSQL a ensuite été exécutée et réussie.
- Service IA : 215 tests réussis, un test optionnel ignoré, dans le conteneur avec
  les dépendances complètes ; 27 tests concernent cette nouvelle explication.
- Mobile : dix tests réussis, dont trois pour la génération, le changement de
  filtres pendant une requête, l’historique, le feedback et les droits de lecture.
  TypeScript et ESLint passent.
- Les 378 références des contrats OpenAPI se résolvent. Migration appliquée et
  toutes les sondes `/health` et `/ready` de la stack au vert.
- Parcours réel dans l’aperçu Expo web de largeur 412 px : génération via
  Express/FastAPI, ouverture d’une analyse historique et avis enregistré en base.
  Les fixtures et leur session ont été supprimées après validation. L’aperçu web
  ignore désormais l’écoute des appuis sur les notifications natives, indisponible
  sur cette plateforme.

[Capture de l’analyse en format mobile](validation/analytics-insights-mobile.png).
La configuration locale utilise le repli déterministe ; les réponses du LLM distant
et ses erreurs sont simulées dans les tests, aucune clé distante n’étant configurée.
