import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { replyToComment, setCommentStatus } from '../comments/service.js';
import { approveSuggestion, rejectSuggestion } from '../response-suggestions/service.js';
import { countPendingDrafts } from './overview.js';
import { readSetting, SETTING_KEYS } from './settings.js';

const DAY_MS = 86_400_000;
const QUEUE_LIMIT = 50;

const percent = (ratio) => (ratio === null || ratio === undefined ? null : Math.max(0, Math.min(100, Math.round(ratio * 100))));

function warningText(warning) {
  if (typeof warning === 'string') return warning;
  return warning?.message ?? warning?.code ?? 'Avertissement de sécurité';
}

// --- Lecture ------------------------------------------------------------------

export async function supervisionSnapshot() {
  const now = Date.now();
  const since24h = new Date(now - DAY_MS).toISOString();
  const since30d = new Date(now - 30 * DAY_MS).toISOString();

  const [settings, queue, pendingTotal, pipeline, feedback, drafting, histogram, unanalysed] = await Promise.all([
    readSetting(SETTING_KEYS.supervision),
    prisma.$queryRaw`
      SELECT rs.id, rs.comment_id, rs.version, rs.text, rs.status::text AS status, rs.confidence_score,
             rs.blocked, rs.warnings, rs.created_at AS draft_created_at,
             c.content, c.author_name, COALESCE(c.meta_created_at, c.created_at) AS commented_at,
             sa.name AS page_name, sa.provider::text AS provider,
             a.sentiment::text AS sentiment
      FROM response_suggestions rs
      JOIN social_comments c ON c.id = rs.comment_id
      JOIN social_accounts sa ON sa.id = c.social_account_id
      LEFT JOIN comment_analyses a ON a.id = c.latest_analysis_id
      WHERE rs.status IN ('PROPOSED', 'EDITED', 'FAILED') AND c.status = 'NEW'
        AND NOT EXISTS (SELECT 1 FROM response_suggestions n WHERE n.comment_id = rs.comment_id AND n.version > rs.version)
      ORDER BY rs.created_at DESC
      LIMIT ${QUEUE_LIMIT}`,
    countPendingDrafts(),
    pipelineCounts(since24h),
    prisma.$queryRaw`
      SELECT COUNT(*) FILTER (WHERE feedback_type = 'ACCEPTED')::int AS accepted,
             COUNT(*) FILTER (WHERE feedback_type = 'EDITED')::int AS edited,
             COUNT(*) FILTER (WHERE feedback_type IN ('REJECTED', 'REGENERATED'))::int AS rejected,
             COUNT(*) FILTER (WHERE created_at >= ${since24h}::timestamptz)::int AS last_day
      FROM ai_feedback WHERE created_at >= ${since30d}::timestamptz`,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS generated, AVG(duration_ms)::float8 AS average_ms
      FROM response_suggestions
      WHERE generated_by_ai AND version = 1 AND created_at >= ${since30d}::timestamptz`,
    prisma.$queryRaw`
      SELECT LEAST(99, FLOOR(confidence_score * 100))::int AS bin, COUNT(*)::int AS count
      FROM response_suggestions
      WHERE generated_by_ai AND confidence_score IS NOT NULL AND created_at >= ${since30d}::timestamptz
      GROUP BY 1`,
    prisma.socialComment.count({ where: { status: 'NEW', latestAnalysisId: null, content: { not: null } } }),
  ]);

  const decided = feedback[0].accepted + feedback[0].edited + feedback[0].rejected;
  const rate = (count) => (decided > 0 ? count / decided : null);

  // 100 classes d'un point de confiance : la console en déduit quelle part des
  // brouillons franchirait un seuil donné, sans nouvel appel à chaque cran du curseur.
  const confidenceDistribution = Array.from({ length: 100 }, () => 0);
  for (const row of histogram) if (row.bin >= 0 && row.bin < 100) confidenceDistribution[row.bin] = row.count;

  return {
    settings: settings.value,
    pipeline: { periodHours: 24, ...pipeline, inReview: pendingTotal },
    analysis: { waiting: unanalysed },
    queue: {
      total: pendingTotal,
      items: queue.map((row) => ({
        id: row.id,
        commentId: row.comment_id,
        network: row.provider.toLowerCase(),
        page: row.page_name,
        commentedAt: new Date(row.commented_at).toISOString(),
        draftedAt: new Date(row.draft_created_at).toISOString(),
        sentiment: row.sentiment ? row.sentiment.toLowerCase() : null,
        author: row.author_name ?? null,
        comment: row.content ?? '',
        draft: row.text,
        version: row.version,
        status: row.status.toLowerCase(),
        confidence: percent(row.confidence_score),
        blocked: row.blocked,
        warnings: Array.isArray(row.warnings) ? row.warnings.map(warningText) : [],
      })),
    },
    performance: {
      periodDays: 30,
      generated: drafting[0].generated,
      decided,
      approvalRate: rate(feedback[0].accepted),
      editedRate: rate(feedback[0].edited),
      rejectedRate: rate(feedback[0].rejected),
      averageDraftMs: drafting[0].average_ms === null ? null : Math.round(drafting[0].average_ms),
      feedbackLast24h: feedback[0].last_day,
    },
    confidenceDistribution,
  };
}

async function pipelineCounts(since) {
  const [detected, drafted, published] = await Promise.all([
    prisma.socialComment.count({ where: { createdAt: { gte: new Date(since) } } }),
    prisma.responseSuggestion.count({ where: { version: 1, generatedByAi: true, createdAt: { gte: new Date(since) } } }),
    prisma.sentResponse.count({ where: { status: 'SUCCEEDED', finishedAt: { gte: new Date(since) } } }),
  ]);
  return { detected, drafted, published };
}

// --- Actions ------------------------------------------------------------------
//
// Un administrateur de la plateforme n'est membre d'aucune marque : les
// middlewares `loadSuggestion`/`loadComment` (qui exigent une appartenance)
// ne s'appliquent donc pas. On charge les mêmes objets, sans contrôle de
// marque, puis on appelle les MÊMES services que le mobile — approbation,
// rejet, envoi et historique d'audit restent une seule implémentation.

async function loadSuggestionForAdmin(suggestionId) {
  const suggestion = await prisma.responseSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      feedback: true,
      comment: { include: { socialAccount: { select: { id: true, brandId: true, provider: true } } } },
    },
  });
  if (!suggestion) throw new HttpError(404, 'not_found', 'Proposition introuvable.');
  return suggestion;
}

/** Approuve la proposition (avec une éventuelle retouche) puis l'envoie chez Meta. */
export async function approveAndSend(suggestionId, { text }, admin, request) {
  const suggestion = await loadSuggestionForAdmin(suggestionId);
  const approved = await approveSuggestion(
    { userId: admin.id, comment: suggestion.comment, suggestion, text },
    request
  );
  // Si l'envoi échoue, la proposition passe à FAILED (voir replyToComment) : elle
  // reste visible dans la file avec le statut « échec » et peut être relancée.
  await replyToComment({ userId: admin.id, comment: suggestion.comment }, request);
  return { id: approved.id, commentId: suggestion.commentId, status: 'sent' };
}

export async function rejectDraft(suggestionId, { reason }, admin, request) {
  const suggestion = await loadSuggestionForAdmin(suggestionId);
  const rejected = await rejectSuggestion(
    { userId: admin.id, comment: suggestion.comment, suggestion, reason },
    request
  );
  return { id: rejected.id, commentId: suggestion.commentId, status: 'rejected' };
}

async function loadCommentForAdmin(commentId) {
  const comment = await prisma.socialComment.findUnique({
    where: { id: commentId },
    include: {
      socialAccount: { select: { id: true, brandId: true, name: true, username: true, provider: true } },
      latestAnalysis: true,
    },
  });
  if (!comment) throw new HttpError(404, 'not_found', 'Commentaire introuvable.');
  return comment;
}

export async function escalateDraft(suggestionId, { note }, admin, request) {
  const suggestion = await loadSuggestionForAdmin(suggestionId);
  const comment = await loadCommentForAdmin(suggestion.commentId);
  await setCommentStatus({ userId: admin.id, comment, toStatus: 'escalated', note }, request);
  return { id: suggestion.id, commentId: comment.id, status: 'escalated' };
}

/** Clôt une escalade : le commentaire passe à « traité », avec l'administrateur dans l'historique. */
export async function resolveEscalation(commentId, { note }, admin, request) {
  const comment = await loadCommentForAdmin(commentId);
  if (comment.status !== 'ESCALATED') {
    throw new HttpError(409, 'conflict', 'Ce commentaire n’est pas escaladé.');
  }
  await setCommentStatus({ userId: admin.id, comment, toStatus: 'processed', note }, request);
  return { id: comment.id, status: 'processed' };
}
