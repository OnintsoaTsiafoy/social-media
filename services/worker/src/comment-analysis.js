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
  SELECT sc.id, sc.content, sc.author_name, sa.brand_id, sa.provider
    FROM social_comments sc
    JOIN social_accounts sa ON sa.id = sc.social_account_id
   WHERE sc.latest_analysis_id IS NULL
     AND sc.content IS NOT NULL
     AND length(btrim(sc.content)) > 0
     AND sc.is_deleted_on_platform = false
   ORDER BY sc.created_at ASC
   LIMIT $1::int
`;

// Jour 3 : qui doit être alerté d'un commentaire signalé sur cette marque.
// Un VIEWER ne peut rien faire d'une alerte de modération, donc il n'est pas
// destinataire — même filtre que notifications/service.js::notifiableBrandMembers
// côté Express, dupliqué ici en SQL brut puisque le worker n'a pas Prisma
// (voir db.js).
const SELECT_NOTIFIABLE_MEMBERS = `
  SELECT user_id
    FROM brand_members
   WHERE brand_id = $1::uuid
     AND role IN ('COMMUNITY_MANAGER', 'ADMIN', 'OWNER')
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

// Mêmes trois signaux que comments/service.js::notificationTypesForAnalysis
// côté Express (analyse à la demande) — un commentaire neutre et non urgent
// ne déclenche jamais rien, sinon chaque commentaire reçu pousserait une
// alerte.
function notificationTypesForAnalysis(analysis) {
  const types = [];
  if (analysis.priority === 'high') types.push('PRIORITY_COMMENT');
  if (analysis.sentiment === 'negative') types.push('NEGATIVE_COMMENT');
  if (analysis.urgent) types.push('URGENT_COMMENT');
  return types;
}

const ANALYSIS_NOTIFICATION_TITLES = {
  PRIORITY_COMMENT: 'Commentaire prioritaire',
  NEGATIVE_COMMENT: 'Commentaire négatif',
  URGENT_COMMENT: 'Commentaire urgent',
};

export function createCommentAnalysis({ query, analyseComment, notifyUser, logger = console }) {
  // Un commentaire signalé notifie TOUS les membres éligibles de la marque :
  // aucun acteur humain n'a déclenché cette passe (contrairement à l'analyse
  // à la demande d'Express), donc personne à exclure.
  async function notifyIfFlagged({ comment, analysisId, analysis }) {
    const types = notificationTypesForAnalysis(analysis);
    if (types.length === 0) return;

    const members = await query(SELECT_NOTIFIABLE_MEMBERS, [comment.brand_id]);
    for (const type of types) {
      for (const member of members) {
        try {
          await notifyUser({
            userId: member.user_id,
            brandId: comment.brand_id,
            type,
            priority: analysis.priority.toUpperCase(),
            title: ANALYSIS_NOTIFICATION_TITLES[type],
            message: comment.author_name
              ? `${comment.author_name} — ${analysis.explanation}`
              : analysis.explanation,
            network: comment.provider,
            resourceType: 'COMMENT',
            resourceId: comment.id,
            eventId: `comment-analysis:${analysisId}:${type}`,
          });
        } catch (error) {
          // Une notification en échec (Express ou Firebase indisponible) ne
          // doit ni interrompre les autres destinataires ni faire échouer
          // l'analyse elle-même, déjà persistée avec succès.
          logger.warn?.({ scope: 'comment-analysis', action: 'notify', commentId: comment.id, type, error: error?.message });
        }
      }
    }
  }

  async function run({ limit = 50 } = {}) {
    const comments = await query(SELECT_UNANALYSED_COMMENTS, [limit]);

    let analysed = 0;
    let failed = 0;
    for (const comment of comments) {
      try {
        const analysis = await analyseComment(comment.id, comment.content);
        const [inserted] = await query(INSERT_ANALYSIS, [
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

        if (notifyUser) await notifyIfFlagged({ comment, analysisId: inserted.id, analysis });
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
