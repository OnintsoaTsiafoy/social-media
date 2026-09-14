# RAG et feedback humain

La base de connaissances est accessible dans **Plus → Base de connaissances**. L’éditeur de réponse affiche les sources et leur proximité avec le commentaire. **Accepter** ou **Valider la modification** enregistre une décision ; **Envoyer la réponse validée** reste une action distincte. **Plus → Qualité des réponses IA** affiche les statistiques de la marque.

## Architecture et correspondance avec le cahier des charges

Le mobile appelle uniquement Express. Express contrôle les droits, lit PostgreSQL, sélectionne les sources et conserve l’historique. FastAPI extrait les fichiers, calcule les embeddings locaux et exécute le graphe NLP/génération/sécurité. Aucun endpoint de génération ou de feedback n’appelle Meta.

Les fonctionnalités existantes sont prolongées pour conserver la compatibilité :

| Concept demandé | Implémentation |
|---|---|
| `knowledge_documents` | Documents personnels, marque, catégorie, contenu extrait, origine, état, révision et erreur d’indexation |
| `knowledge_chunks` | Passages avec vecteur `vector(384)`, numéro, positions, nombre de tokens et FK document |
| `ai_responses` | `response_suggestions`, avec les versions existantes, `generated_text`, `final_text`, génération d’origine, analyse, stratégie, durée et confiance |
| `ai_response_sources` | Instantanés JSON `sources` sur chaque version : titre, document, passage, contenu, révision et score |
| `ai_feedback` | Une décision terminale par génération, auteur, date, motif, note et distance d’édition |
| `validated_response_examples` | Commentaire et réponse validée, analyse et embedding pour retrouver les cas similaires |
| `brand_ai_profile` | `brand_ai_settings` déjà versionné : ton, langue, longueur, salutation, emojis, termes interdits, instructions et escalade vers le support |

L’API conserve les états opérationnels `proposed`, `edited`, `approved`, `rejected`, `sent`, `failed`. Les décisions distinctes sont `ACCEPTED`, `EDITED`, `REJECTED`, `REGENERATED`. Une édition de brouillon seule n’est pas une validation : elle devient un exemple réutilisable lors de son approbation. Une régénération garde l’ancienne version et clôt la génération encore sans décision. Les décisions antérieures déjà validées restent conservées.

## Installation et migration

```powershell
npm --prefix services/api run prisma:generate
npm --prefix social-media install
./scripts/start.ps1
docker compose run --rm --no-deps ai-service python -m modules.knowledge.warmup
```

Le démarrage de l’API applique `20260914010000_rag_human_feedback`. PostgreSQL reste en version 16 Alpine, avec pgvector compilé dans `services/postgres/Dockerfile` pour conserver l’environnement du volume existant. La migration crée l’extension, les tables, les colonnes et deux index HNSW cosinus. Les données existantes sont conservées ; aucun feedback humain historique n’est inventé.

La nouvelle dépendance native mobile est `expo-document-picker` : reconstruire l’application de développement si elle utilise un binaire natif existant.

`npm --prefix social-media run typecheck` régénère les types de navigation Expo avant TypeScript, y compris sans Metro actif et sous Windows.

Configuration ajoutée : `RAG_MIN_SIMILARITY=0.82`, transmis à Express dans Compose. Le modèle est fixé à `intfloat/multilingual-e5-small`, dimension 384, avec préfixes `query:` et `passage:`, pooling moyen et normalisation. Le téléchargement initial est placé dans le volume `embedding_models`. Aucune clé d’embedding n’est requise ; le modèle fonctionne ensuite localement. Changer le modèle exige de réindexer documents et exemples ; changer sa dimension exige aussi une migration.

Le générateur LLM existant utilise `AI_GENERATION_MODE=llm` et `ANTHROPIC_API_KEY`. Sans configuration LLM, le mode RAG propose un extrait documentaire **bloqué à l’acceptation directe**, à adapter dans l’éditeur. Il est explicitement identifié comme extrait, sans prétendre appliquer le ton ou traduire. Sans source suffisante, une proposition de validation humaine est également bloquée. Une réponse manuelle vérifiée peut être enregistrée et repasse le contrôle de sécurité. Les générations LLM restent soumises à approbation humaine.

## Import et indexation

Catégories : FAQ, produit, service, politique, SAV, consignes/modération, ton de marque et autre. Horaires, contact, livraison, retours et procédures de transfert peuvent être renseignés comme FAQ, politique ou service.

Formats : saisie manuelle, TXT UTF-8, CSV UTF-8, PDF texte et DOCX avec paragraphes/tableaux. Taille maximale : 10 Mio, 250 000 caractères extraits, 200 pages PDF et 256 passages. Le type MIME, l’extension et la structure sont vérifiés. Un PDF sans texte ou chiffré est refusé avec une explication ; l’OCR n’est pas fourni. Le fichier binaire n’est pas conservé, seuls son nom et le texte extrait le sont.

Les passages comportent au plus 480 tokens E5 et 64 tokens de recouvrement. Cette taille est volontairement inférieure aux 500–1 000 tokens suggérés dans le document : E5-small accepte 512 tokens, préfixe et tokens spéciaux compris. Le découpage préfère les fins de phrase et conserve les positions dans le texte nettoyé.

États : `PENDING → INDEXING → READY`, ou `FAILED`. L’indexation est synchrone et bornée. Les autres lectures peuvent afficher l’état en cours. Une erreur conserve le texte pour réessayer. Les anciennes entrées d’un document en erreur ne participent plus aux recherches. Le remplacement des passages et le passage à READY sont atomiques. La révision empêche une ancienne indexation d’écraser une modification concurrente ; la suppression cascade vers tous les embeddings.

## Recherche et garde-fous

La recherche documentaire filtre **utilisateur propriétaire + marque autorisée + document READY + document public + modèle compatible**. Les membres d’une même marque ne lisent pas les documents privés d’un collègue. Les documents marqués internes restent consultables par leur propriétaire, mais sont exclus du contexte de génération publique. Les anciennes réponses validées sont partagées dans la marque et ne proviennent jamais d’une autre marque.

Le Top K documentaire est plafonné à 10 (5 pour la génération). La similarité cosinus minimale est 0,82 par défaut. Les index HNSW sont présents ; la recherche documentaire courante calcule exactement les distances sur le sous-ensemble autorisé matérialisé pour éviter qu’un filtrage après HNSW ne perde les résultats de petites marques.

La confiance documentaire est la meilleure similarité retrouvée, ou zéro. Elle mesure la proximité et **n’est pas une probabilité de véracité**. L’écran distingue élevée (≥ 0,85), moyenne (≥ 0,70) et faible. Le seuil doit être recalibré sur des documents représentatifs. Le corpus de vérification montre qu’un seuil de 0,78 retourne des sources pour certaines questions absentes ; 0,82 réduit ces faux positifs mais peut exclure une question arabe pourtant couverte en français.

Le prompt inclut commentaire, analyse NLP, contexte de publication, derniers échanges effectivement envoyés, charte de marque, documents et jusqu’à trois exemples similaires validés. Les documents et exemples sont traités comme données non fiables, jamais comme instructions. Les exemples guident le style sans justifier des faits commerciaux. Une demande explicite de langue prévaut ; sinon le parcours RAG utilise la langue détectée lorsqu’elle est prise en charge.

Les sources sont conservées avec chaque version même si le document est modifié ou supprimé ensuite. Le mobile ne reçoit ni vecteurs ni contenu intégral des passages dans les réponses proposées : uniquement les identifiants, titres, scores et révisions. Les audits n’enregistrent pas le contenu des documents. Les motifs et notes restent facultatifs.

## Feedback et concurrence

Acceptation, correction validée, rejet et remplacement par régénération sont journalisés. Une contrainte unique sur la génération évite les doubles comptages. Un verrou transactionnel par commentaire sérialise les changements de version et les décisions. Une acceptation rejouée est idempotente ; une décision contradictoire ou sur une version dépassée retourne 409.

`generated_text` conserve la sortie IA de chaque génération ; `original_text` conserve la première proposition historique du commentaire ; `final_text` et le feedback conservent la réponse approuvée. La distance d’édition est calculée en points de code Unicode. Les brouillons manuels ne sont pas comptés comme générations IA. Une panne d’embedding ne perd pas la validation : les exemples non vectorisés sont réessayés par lots de cinq avant une génération suivante.

Les statistiques comprennent volumes, taux sur le total des générations, confiance moyenne, durée moyenne, distance de correction, satisfaction et répartitions par sentiment/intention. Les versions humaines intermédiaires n’augmentent pas le dénominateur. Les réponses antérieures à cette migration sans feedback restent des générations sans décision enregistrée.

## Vérification et expérience

```powershell
npm --prefix services/api test
npm --prefix services/worker test
npm --prefix social-media run typecheck
npm --prefix social-media run lint
docker compose run --rm --no-deps -e RAG_INTEGRATION=1 -v "${PWD}/services/api/test:/app/services/api/test:ro" api node --test test/rag.integration.test.js
docker compose run --rm --no-deps -v "${PWD}/services/api/test:/app/services/api/test:ro" api node test/rag.live-smoke.js
docker compose run --rm --no-deps -e RAG_EMBEDDING_TEST=1 ai-service python -m pytest -q tests -p no:cacheprovider
docker compose run --rm --no-deps -v "${PWD}/services/ai-service:/app" ai-service python -m evaluation.compare --local
```

Les tests d’intégration utilisent PostgreSQL/pgvector réels, créent des utilisateurs et marques temporaires, puis les suppriment. Les appels IA sont mockés dans cette suite pour tester les décisions et l’isolation de façon reproductible ; la suite Python possède séparément un test du modèle multilingue réel. Aucun test n’envoie de réponse à Meta.

Le test `rag.live-smoke.js` utilise la stack démarrée avec son modèle d’embedding réel et le générateur local : import TXT, recherche d’une FAQ, absence de source pour un prix inconnu, blocage de l’acceptation directe, correction validée, réutilisation de l’exemple et statistiques. Il supprime ses données temporaires et vérifie qu’aucune réponse n’a été envoyée.

Vérification locale du 14 septembre 2026 : 123 tests API réussis (intégration ignorée dans la suite unitaire), 1 scénario d’intégration PostgreSQL réussi, 181 tests IA réussis avec embeddings réels, 158 tests du gateway et 50 tests worker réussis. Le parcours complet ci-dessus, TypeScript, Expo ESLint et l’export web passent également. L’import natif sur un appareil mobile n’a pas été testé.

Le corpus synthétique `services/ai-service/evaluation/fixtures.json` comprend 12 cas, dont questions françaises/anglaises/arabes, informations absentes et tentative d’injection. Le script produit 36 générations, le tableau, les métriques et une grille de notation laissée vide. [Résultats de la vérification locale](../services/ai-service/evaluation/results/comparison.md).

Pour générer le graphique SVG/PNG, installer `evaluation/requirements.txt` dans un environnement Python puis exécuter `python -m evaluation.report evaluation/results` depuis `services/ai-service`. Pour une comparaison avec le vrai LLM, configurer celui-ci et retirer `--local` ; le script refuse de présenter une exécution sans LLM comme une expérience LLM. Cela effectue des appels au fournisseur configuré.

La pertinence, l’exactitude, le respect du ton, le respect des règles et la satisfaction doivent être notés de 1 à 5 par des évaluateurs dans `human-ratings.csv`, avec décision `accepted`, `edited` ou `rejected` et réponse finale. `evaluation.report` agrège ces données ; les métriques humaines non renseignées restent nulles. L’export paginé `/ai/feedback/dataset` fournit également les interactions validées du produit.

L’expérience humaine et la comparaison avec un LLM réel restent à réaliser : les résultats locaux vérifient le pipeline, la recherche et les blocages, sans démontrer une amélioration de qualité rédactionnelle. Le jeu utilisé pour régler le seuil est trop petit et ne constitue pas un jeu de test indépendant.

## Références techniques

- [pgvector : extension, cosinus, HNSW et filtrage](https://github.com/pgvector/pgvector)
- [FastEmbed : déclaration d’un modèle E5 personnalisé](https://github.com/qdrant/fastembed#-dense-text-embeddings)
- [Modèle multilingue E5-small et préfixes](https://huggingface.co/intfloat/multilingual-e5-small)
- [pypdf : extraction et limites](https://pypdf.readthedocs.io/en/stable/user/extract-text.html)
