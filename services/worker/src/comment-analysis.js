/**
 * Analyse automatique des commentaires reçus (Sprint 09 Jour 5).
 *
 * Complète l'analyse à la demande d'Express : un community manager ne devrait
 * pas avoir à cliquer « Analyser » sur chaque commentaire pour que sa boîte de
 * réception soit triable par priorité.
 *
 * Déclenchement par balayage périodique plutôt que par événement : les
 * commentaires arrivent par le webhook Meta, reçu par graph-api, qui n'est pas
 * producteur pg-boss (il écrit directement en base). Faire produire un job à
 * graph-api l'obligerait à connaître la file — un couplage que ni le Sprint 08
 * ni celui-ci n'ont besoin d'introduire. Le balayage reprend donc simplement
 * ce qui n'a pas encore d'analyse, ce qui rattrape aussi bien un webhook qu'un
 * commentaire arrivé par la synchronisation de secours.
 *
 * Différence assumée avec comment-sync.js : ici, c'est bien le worker qui
 * ÉCRIT. ai-service est sans état et ne connaît pas la base (il ne reçoit
 * qu'un texte et renvoie un verdict), contrairement à graph-api qui possède
 * les données Meta et les persiste lui-même.
 */

const SELECT_UNANALYSED_COMMENTS = `
  SELECT id, content
    FROM social_comments
   WHERE latest_analysis_id IS NULL
     AND content IS NOT NULL
     AND length(btrim(content)) > 0
     AND is_deleted_on_platform = false
   ORDER BY created_at ASC
   LIMIT $1::int
`;

// Insertion et mise à jour du pointeur en UN SEUL énoncé : le CTE rend
// l'ensemble atomique sans transaction explicite, même idiome que les
// réclamations conditionnelles de delivery.js. Sans ça, un arrêt du worker
// entre les deux écritures laisserait une analyse orpheline, invisible de la
// boîte de réception et jamais reprise (le commentaire garderait
// latest_analysis_id NULL et serait réanalysé au balayage suivant).
const INSERT_ANALYSIS = `
  WITH inserted AS (
    INSERT INTO comment_analyses (
      comment_id, sentiment, intent, priority, confidence,
      sentiment_confidence, intent_confidence, low_confidence,
      is_urgent, is_sensitive, language, recommended_action, explanation,
      signals, top_terms, model_version, dataset_version
    ) VALUES (
      $1::uuid, $2::"CommentSentiment", $3::"CommentIntent", $4::"CommentPriority", $5::double precision,
      $6::double precision, $7::double precision, $8::boolean,
      $9::boolean, $10::boolean, $11::varchar, $12::text, $13::text,
      $14::jsonb, $15::jsonb, $16::varchar, $17::varchar
    )
    RETURNING id, comment_id
  )
  UPDATE social_comments
     SET latest_analysis_id = inserted.id
    FROM inserted
   WHERE social_comments.id = inserted.comment_id
  RETURNING inserted.id
`;

export function createCommentAnalysis({ query, analyseComment, logger = console }) {
  async function run({ limit = 50 } = {}) {
    const comments = await query(SELECT_UNANALYSED_COMMENTS, [limit]);

    let analysed = 0;
    let failed = 0;
    for (const comment of comments) {
      try {
        const analysis = await analyseComment(comment.id, comment.content);
        await query(INSERT_ANALYSIS, [
          comment.id,
          analysis.sentiment.toUpperCase(),
          analysis.intent.toUpperCase(),
          analysis.priority.toUpperCase(),
          analysis.confidence,
          analysis.sentimentConfidence,
          analysis.intentConfidence,
          analysis.lowConfidence,
          analysis.urgent,
          analysis.sensitive,
          analysis.language,
          analysis.recommendedAction,
          analysis.explanation,
          JSON.stringify(analysis.signals ?? []),
          JSON.stringify(analysis.topTerms ?? []),
          analysis.modelVersion,
          analysis.datasetVersion,
        ]);
        analysed += 1;
      } catch (error) {
        // Un commentaire en échec ne doit pas interrompre le lot : il reste
        // sans analyse et sera repris au balayage suivant, ce qui rend aussi
        // un service IA temporairement indisponible sans conséquence durable.
        failed += 1;
        logger.warn?.({ scope: 'comment-analysis', commentId: comment.id, error: error?.message });
      }
    }

    return { inspected: comments.length, analysed, failed };
  }

  return { run };
}
