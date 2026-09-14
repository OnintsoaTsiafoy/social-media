# RAG / feedback — API publique v1

Préfixe : `/api/v1`. Authentification Bearer requise. Identifiants UUID. Succès : `{data, meta: {requestId}}`. Erreur : `{error: {code, message, details?, requestId}}`. Aucun endpoint de cette fiche ne publie sur un réseau social.

## Connaissances

| Méthode | Route | Entrée | Sortie |
|---|---|---|---|
| POST | `/knowledge` | `{brandId,title,documentType,content,internal?}` | 201 document avec contenu et état d’indexation |
| POST | `/knowledge/upload` | multipart `file,brandId,title,documentType,internal` | 201 document ; `internal` chaîne `true`/`false` |
| GET | `/knowledge` | query `brandId,page=1,pageSize=20` | `{items,total,page,pageSize}` |
| GET | `/knowledge/:id` | — | document et contenu |
| PUT | `/knowledge/:id` | `{revision,title,documentType,content,internal?}` | document réindexé |
| DELETE | `/knowledge/:id` | — | 204 |
| POST | `/knowledge/:id/reindex` | — | document, READY ou FAILED |
| POST | `/ai/retrieve` | `{brandId,query,limit?}` | `{results,confidenceScore}` |

Document : `{id,brandId,title,documentType,source,originalFilename,internal,status,revision,error,chunkCount,indexedAt,createdAt,updatedAt,content?}`. `documentType` : FAQ/PRODUCT/SERVICE/POLICY/SAV/GUIDELINE/BRAND_TONE/OTHER. État : PENDING/INDEXING/READY/FAILED. Les contenus d’indexation ne retournent jamais d’embedding.

Résultat de recherche : `{documentId,chunkId,title,content,chunkIndex,revision,score}`. Score cosinus, limité par `RAG_MIN_SIMILARITY`. `limit` entre 1 et 10, `query` entre 1 et 4 000 caractères. Documents personnels publics uniquement. Les routes GET sont accessibles aux VIEWER ; les mutations et la recherche exigent COMMUNITY_MANAGER ou supérieur.

Import : 10 Mio maximum, PDF/DOCX/TXT/CSV, 250 000 caractères extraits maximum. `title` ≤ 200 caractères. Liste paginée de 1 à 50 documents. Erreurs : 400 format/paramètres, 401 session, 403 rôle, 404 ressource étrangère/absente, 409 révision dépassée, 413 fichier volumineux. Une panne d’indexation après enregistrement retourne un document FAILED avec `error` et possibilité de relance.

## Réponses et feedback

`/ai/responses` est un alias compatible de `/response-suggestions`.

| Méthode | Route | Entrée / comportement |
|---|---|---|
| POST | `/ai/responses` | `{commentId,tone?,language?,instruction?,strategy?}` ; 201 nouvelle génération |
| GET | `/ai/responses` | query `commentId` ; toutes les versions |
| GET | `/ai/responses/:id` | une version |
| POST | `/ai/responses/:id/accept` | `{text?,reason?,rating?,feedbackComment?}` ; valide, sans envoyer |
| POST | `/ai/responses/:id/edit` | mêmes champs, `text` obligatoire ; nouvelle version et validation |
| POST | `/ai/responses/:id/reject` | `{reason?,rating?,feedbackComment?}` |
| POST | `/ai/responses/:id/regenerate` | `{tone?,language?,instruction?,strategy?}` ; 201 nouvelle génération |
| GET | `/ai/feedback/stats` | query `brandId` |
| GET | `/ai/feedback/dataset` | query `brandId,page=1,pageSize=20` |

Stratégies : `llm`, `rag`, `rag_feedback` (défaut). `llm` sert aussi de référence expérimentale. Le PATCH existant sur `/response-suggestions/:id` enregistre un brouillon sans validation. Le POST `/approve` existant reste un alias de l’acceptation. `text` ≤ 500, `reason` ≤ 500, `rating` entier 1–5, `feedbackComment` ≤ 1 000 caractères.

La réponse conserve les champs existants et ajoute : `generatedText`, `finalText`, `confidenceScore`, `sources[]` (`documentId,chunkId,title,score,revision`), `similarExamples[]` (`id,score`), `feedbackStatus`, `strategy`. Les documents complets, vecteurs et contenus des anciens exemples ne sont pas renvoyés dans ce DTO.

`feedbackStatus` : ACCEPTED/EDITED/REJECTED/REGENERATED ou null. Une version humaine validée conserve `status=approved`, et son feedback porte EDITED si son texte diffère de la génération d’origine. Une proposition bloquée, traitée ou dépassée ne peut pas être approuvée : 409. Les autres marques renvoient 404. Les validations répétées d’une même version ne dupliquent pas les décisions.

Statistiques : `generated,accepted,edited,rejected,regenerated,acceptanceRate,editRate,rejectionRate,averageConfidence,averageEditDistance,averageDurationMs,averageRating,sentiments,intents,strategies`. Les taux divisent les décisions par les générations, pas par les versions de brouillons. Moyennes sans observations : null.

Dataset : `{page,pageSize,items}` ; chaque item contient commentaire, analyse, texte IA, texte final, décision, confiance, note, stratégie, générateur et durée. L’accès exige COMMUNITY_MANAGER. L’envoi réel reste le POST existant `/comments/:id/reply`, après approbation.
