# Sprint 10 — LangGraph, réponses personnalisées et hashtags

Cette livraison applique la tranche Sprint 10 du plan
(`sprint_listing/SPRINT_10_LANGGRAPH_REPONSES_HASHTAGS.md`) : un graphe
LangGraph qui orchestre analyse et génération, des propositions de réponse
pilotées par les paramètres de marque, un contrôle de sécurité structuré, un
cycle humain complet (générer / modifier / régénérer / approuver / rejeter) et
la génération de hashtags.

**La règle qui structure tout le sprint : rien ne part sans approbation
humaine explicite, et cette règle est vérifiée côté serveur**, pas seulement
suggérée par l'interface. `POST /comments/{id}/reply` ne prend plus de texte :
il publie le contenu de la proposition approuvée. Accepter un texte libre à
l'envoi aurait vidé l'approbation de son sens — n'importe quel contenu aurait
pu être publié derrière elle.

## Le graphe

`services/ai-service/modules/workflow/` — huit nœuds, deux branches
conditionnelles :

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

Chaque nœud est une fonction pure de l'état vers un fragment d'état : c'est ce
qui permet de les tester isolément sans construire le graphe, et la raison pour
laquelle aucune logique ne vit dans l'assemblage. **Aucun nœud ne lève** — une
erreur est écrite dans `errors` et le graphe décide de la suite ; une exception
traversant LangGraph ferait perdre l'état partiel, donc la raison de l'échec.

`decide_action` est le **seul point de sortie** : quel que soit le chemin,
l'appelant reçoit un état complet avec une action explicite
(`propose` / `escalate` / `blocked` / `failed`), jamais une réponse partielle.
Aucune de ces valeurs ne déclenche de publication : la plus engageante est
« escalade », et un test le verrouille explicitement.

Décisions de nœuds qui méritent d'être dites :

- **La langue du commentaire ne décide pas la langue de la réponse.** Priorité :
  le choix du community manager, puis la langue de la marque, puis le français.
  Répondre automatiquement dans la langue de l'auteur serait un choix éditorial
  que la marque n'a pas fait ; un commentaire détecté non francophone produit
  une information, pas un basculement.
- **Une analyse en échec n'arrête pas la génération.** La proposition est alors
  générique et un avertissement le dit — mieux qu'un écran en erreur.
- **Un sujet sensible ne bloque pas la génération** : le community manager a
  justement besoin d'un brouillon. Il est routé vers `escalate` avec un
  avertissement de relecture.
- **Un commentaire trop long est tronqué, pas refusé.** Le refuser priverait
  d'aide sur le message le plus pénible à traiter.

## Génération : local par défaut, Claude en option

`AI_GENERATION_MODE=local` (défaut) compose la réponse à partir des réglages de
marque : ton, tutoiement/vouvoiement, emojis autorisés, longueur visée,
formules d'accueil et de clôture, consignes. Aucune clé, aucun réseau — la
démonstration et les tests du sprint fonctionnent hors ligne, et les tests de
cohérence portent sur des sorties stables plutôt que sur un modèle qui change
d'une exécution à l'autre. Même précédent que `MockSocialProvider` (Sprint 04).

`AI_GENERATION_MODE=llm` + `ANTHROPIC_API_KEY` route la génération vers Claude
(SDK officiel `anthropic`, modèle `claude-opus-5`, effort `low` : rédiger deux
phrases conformes à une charte est une tâche simple, et le community manager
attend devant son écran). **Le repli est automatique et visible** : si le
modèle est indisponible, refuse, ou renvoie autre chose que prévu, le
générateur local reprend la main et un avertissement `llm_fallback` dit au
community manager laquelle des deux sources il a sous les yeux. Le repli
rattrape `Exception` et pas seulement les erreurs anticipées : le chemin
distant est justement celui dont on ne maîtrise rien, et ne rattraper que le
prévu ferait échouer la génération sur la seule classe d'erreurs qu'on n'avait
pas vue venir.

`generator` et `promptVersion` remontent jusqu'en base avec chaque proposition.
Sans eux, impossible de savoir trois semaines plus tard si un texte venait du
modèle ou du repli local, ni sous quelles consignes — c'est le risque « ne pas
conserver la version du prompt » de la fiche.

### Deux détails de rédaction corrigés en cours de route

- **Un ton ne s'exprime pas en ajoutant une phrase, il change la formulation.**
  Le ton empathique ajoutait d'abord une phrase d'empathie *avant* l'accusé de
  réception. Avec une marque réglée sur « 2 phrases », cette phrase était
  systématiquement la première sacrifiée : le ton choisi n'apparaissait jamais
  dans les réponses courtes. L'empathie **remplace** désormais l'accusé de
  réception standard.
- **Les phrases portent un rang d'importance**, utilisé uniquement pour choisir
  quoi sacrifier quand la marque impose une longueur courte. Tronquer par la fin
  gardait l'ornement et jetait le fond (« nous prenons votre dossier en
  charge »).
- **Les formules de marque ne sortent pas de la langue de la marque.** Réutiliser
  « Bonjour {prénom}, » et « À très vite ! » dans une réponse en anglais
  produisait un message bilingue.

### Injection de prompt

Le commentaire est du contenu non maîtrisé. Le prompt le délimite explicitement
et le système dit qu'il s'agit d'une **donnée, pas d'une instruction**. Le
garde-fou réel reste toutefois le contrôle de sortie : un test vérifie qu'une
consigne demandant un remboursement immédiat produit bien une proposition
**bloquée** — s'il suffisait de demander l'interdit pour l'obtenir, la barrière
ne servirait à rien.

## Contrôle de sécurité

`modules/safety/checks.py`. Il s'applique **quel que soit l'auteur du texte** :
générateur local, Claude, ou réécriture humaine. C'est le point important — la
réécriture humaine est le moment où un engagement non autorisé a le plus de
chances d'apparaître, et un contrôle limité aux sorties du modèle passerait à
côté. `POST /internal/v1/responses/safety-check` existe pour ça.

| Niveau | Effet | Contenu |
|---|---|---|
| `blocking` | **Interdit l'approbation** (409 côté Express) | terme interdit de la marque, engagement non autorisé (remboursement, garantie, délai chiffré, compensation), donnée personnelle en public, réponse vide, réponse trop longue |
| `warning` | Affiché, l'humain décide | langue différente de celle demandée, emoji alors que la marque les interdit, Markdown (Meta ne l'interprète pas), sujet sensible, repli sur le générateur local |
| `info` | Affiché discrètement | ton personnalisé non applicable, analyse peu fiable, commentaire dans une autre langue |

Deux niveaux et un seul qui bloque : un contrôle qui bloque trop serait
contourné, donc inutile. Les avertissements sont **structurés**
(`code`, `severity`, `message`, `matches`) et non de simples chaînes, pour que
l'écran puisse les traiter différemment selon le code.

## Cycle humain et persistance

Migration `20260913010000_response_suggestions`.

| Objet | Rôle |
|---|---|
| `response_suggestions` | Une ligne par version. Générer, modifier ou régénérer **ajoute** ; approuver ou rejeter met à jour la dernière. `originalText` porte la proposition telle que l'IA l'a produite et n'est jamais réécrit — c'est la réponse à « conserver texte original et final ». |

**Pas de pointeur `latest_suggestion_id`**, contrairement aux analyses du
Sprint 09. La distinction est volontaire : une analyse est *filtrée et triée*
(elle a besoin d'une jointure indexable), une proposition est seulement
*affichée*. Une lecture groupée par page — même idiome que
`resolvePublicationRefs` — suffit et évite d'ajouter un second invariant à
maintenir.

| Route Express | Rôle |
|---|---|
| `POST /api/v1/response-suggestions` | Sans `text` : génération IA. Avec `text` : le community manager a rédigé, on enregistre sa version — contrôlée quand même. |
| `GET /api/v1/response-suggestions?commentId=` | Toutes les versions, ordre croissant, y compris rejetées. |
| `PATCH /api/v1/response-suggestions/{id}` | Réécriture humaine → nouvelle version, `generatedByAi: false`, recontrôle. |
| `POST …/{id}/approve` | Seul chemin ouvrant l'envoi. `text` permet d'approuver une ultime retouche en une requête : elle devient une version, recontrôlée, puis approuvée — le texte approuvé est donc exactement celui qui partira. 409 si bloqué. |
| `POST …/{id}/reject` | La version reste dans l'historique. |
| `POST /api/v1/publications/generate-hashtags` | Hashtags et mots-clés. |

`POST /comments/{id}/reply` refuse désormais : aucune proposition (409), une
proposition non approuvée (409). Un échec d'envoi marque la proposition
`FAILED` plutôt que de la laisser « approuvée » — sinon l'écran laisserait
croire qu'elle est partie. Un succès la marque `SENT`, et l'audit enregistre
l'identifiant de version et **qui** l'avait approuvée.

`pendingAiResponses` des compteurs devient réel : commentaires ayant une
proposition en attente de décision (`distinct` par commentaire, pour que
plusieurs versions ne comptent pas plusieurs fois).

L'historique du commentaire expose enfin les huit genres prévus côté mobile
depuis le Sprint 01 : `response_proposed` et `response_edited` ont désormais
une source réelle.

## Hashtags

Extraction déterministe, **sans modèle de langue, y compris en mode `llm`**.
Limite assumée et documentée : les hashtags viennent du texte que l'auteur vient
d'écrire et des termes recommandés de la marque, donc toujours pertinents et
jamais inventés — mais aucune thématique absente du texte n'émergera
(« #madeinfrance » ne sortira pas d'un post qui ne parle pas de fabrication).
L'écran permet de toute façon d'en ajouter à la main.

La normalisation reproduit exactement `normaliseHashtag()` du mobile : deux
implémentations divergentes produiraient des doublons invisibles (« #Été » et
« #ete » comptés séparément). `preserve` renvoie en tête la sélection déjà
faite et ne la laisse jamais évincer par le plafond — risque explicite de la
fiche. `hashtags` et `keywords` viennent de la **même** extraction, donc
l'encart « mots-clés détectés » et les propositions ne peuvent pas se
contredire.

## Sécurité des appels internes

Nouveau scope `ai:generate`, distinct de `ai:analyze` : analyser un commentaire
et rédiger au nom de la marque ne sont pas la même autorisation. Un jeton
portant seulement `ai:analyze` reçoit 403 sur les routes de génération, et un
jeton d'audience `social-service` (graph-api) reçoit 401 — les deux sont
testés.

Les routes de génération sont déclarées `def` et non `async def` : en mode
`llm` elles font un appel réseau bloquant, que Starlette exécute alors dans un
pool de threads. En `async def`, cet appel gèlerait la boucle d'événements et
donc tout le service pendant la génération.

## Mobile

Aucun écran recréé. `generateResponse`, `saveResponse`, `rejectResponse`,
`approveAndSend`, `generateHashtags` et `detectKeywords` passent de fixtures à
appels réels. Les signatures évoluent pour porter l'identifiant de version
(`response.id`), que l'éditeur possédait déjà.

L'éditeur de réponse (écran 19) affiche les avertissements du serveur avec le
ton correspondant à leur sévérité, et refuse d'envoyer une proposition bloquée
dont le texte n'a pas été corrigé — plutôt que d'envoyer une requête vouée au
409. Si le texte a changé depuis, la requête part : l'approbation recontrôle la
nouvelle version, et la correction a peut-être levé le blocage.

Le bricolage du Sprint 08 disparaît : `approveAndSend` ne fabrique plus une
`AiResponse` de synthèse, le serveur renvoie la vraie.

`AiResponse` gagne `warnings`, `blocked`, `generator` et `promptVersion`.

## Tests

`services/ai-service` : **166 tests** (+90). Nouveaux fichiers :
`test_safety.py` (chaque famille d'avertissement, ce qui bloque et ce qui ne
bloque pas), `test_generation.py` (formules de marque, tons, registres,
longueur, langues, prompt, hashtags), `test_workflow.py` (chaque nœud isolé,
puis le graphe : chemin nominal, court-circuit sur commentaire vide,
consigne interdite bloquée, escalade d'un sujet sensible, déterminisme,
garde-fou « aucune sortie n'envoie », et les quatre comportements du chemin
LLM — utilisé, indisponible, refus, réponse tronquée — avec un client factice,
aucun appel réel), `test_assistance_routes.py` (les quatre routes,
authentification, scopes, audience, bornes).

`services/api` : **73 tests** (+10) dont `response-suggestions.test.js`.
`services/worker` : 33 tests, inchangés. `graph-api` : 153 tests, aucune
régression. Mobile : `tsc --noEmit` et `expo lint` verts.

## Scénario de vérification manuelle

1. `docker compose up --build` : `ai-service` répond `/ready` 200 sans aucune
   clé d'API — le mode `local` est le défaut.
2. Écran 19 sur un commentaire de réclamation : « Régénérer » produit une
   proposition conforme au ton et aux formules de la marque ; une seconde
   génération crée une v2 sans effacer la v1 (visible dans l'historique).
3. Réécriture du texte puis « Enregistrer » : nouvelle version, mention
   « Généré par l'IA » disparue.
4. Saisie de « nous vous remboursons intégralement » puis « Approuver &
   envoyer » : bloqué, avertissement explicite, aucun appel à Meta. Correction
   du texte : l'approbation repasse et l'envoi part.
5. Appel direct de `POST /comments/{id}/reply` sans approbation préalable :
   409, rien n'est publié.
6. `AI_GENERATION_MODE=llm` sans clé : le générateur local prend la main
   silencieusement (mode non configuré). Avec une clé invalide : proposition
   locale **et** avertissement `llm_fallback` affiché.
7. Modale hashtags (écran 11) : les propositions viennent du texte du
   brouillon, les hashtags saisis à la main survivent à une régénération.

## Décisions et limites

- **Les hashtags n'utilisent jamais de modèle de langue** (voir plus haut).
- **Le générateur local ne rédige qu'en français et en anglais.** L'arabe,
  proposé par l'écran, produit une réponse en français **et** un avertissement
  explicite plutôt qu'un texte inventé. Le mode `llm` n'a pas cette limite.
- **Le ton `custom`** (texte libre) ne peut pas être appliqué par composition
  déterministe : le générateur local le signale au lieu de laisser croire qu'il
  en a tenu compte. Le mode `llm` le transmet réellement.
- **L'historique transmis au générateur est borné à 5 échanges sur le seul
  commentaire concerné** — jamais l'historique de l'auteur sur d'autres
  publications (risque « inclure trop d'historique sensible »).
- **Aucune évaluation quantitative de la qualité rédactionnelle.** Contrairement
  au Sprint 09, il n'y a pas de métrique : les tests vérifient des propriétés
  (le ton apparaît, la longueur est respectée, l'interdit est bloqué), pas une
  qualité mesurée. Un jeu d'évaluation de la génération n'est pas planifié à ce
  jour.
- **Le chemin Claude n'a jamais été exercé contre l'API réelle** : il est testé
  avec un client factice, comme les appels Meta le sont avec respx. Coût,
  latence et qualité réels restent à mesurer avec une vraie clé.
