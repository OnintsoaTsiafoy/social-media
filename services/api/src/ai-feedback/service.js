import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/http.js';
import { writeAuditLog } from '../lib/audit.js';
import { EMBEDDING_MODEL, queryEmbedding } from '../knowledge/service.js';

export function editDistance(before, after) {
  const a = Array.from(before), b = Array.from(after);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

export async function lockComment(tx, commentId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${commentId}))`;
}

export async function recordFeedback(tx, { suggestion, comment, userId, type, finalResponse, reason, rating, feedbackComment }, request) {
  const responseId = suggestion.generationId ?? (suggestion.generatedByAi ? suggestion.id : null);
  if (!responseId) return null; // A wholly human draft is not an AI generation.
  const origin = await tx.responseSuggestion.findUniqueOrThrow({ where: { id: responseId } });
  const existing = await tx.aiFeedback.findUnique({ where: { responseId } });
  if (existing) {
    if (existing.feedbackType === type && existing.finalSuggestionId === suggestion.id && existing.finalResponse === (finalResponse ?? null)) return existing;
    throw new HttpError(409, 'conflict', 'Cette génération a déjà reçu une décision. Régénérez une proposition.');
  }
  const feedback = await tx.aiFeedback.create({ data: {
    responseId, finalSuggestionId: suggestion.id, userId, feedbackType: type,
    finalResponse: finalResponse ?? null, reason: reason ?? null, rating: rating ?? null, comment: feedbackComment ?? null,
    editDistance: finalResponse == null ? null : editDistance(origin.generatedText ?? origin.text, finalResponse),
  } });
  if (type === 'ACCEPTED' || type === 'EDITED') {
    await tx.responseSuggestion.update({ where: { id: responseId }, data: { finalText: finalResponse } });
    await tx.validatedResponseExample.create({ data: {
      brandId: comment.socialAccount.brandId, responseId, commentText: comment.content ?? '',
      finalResponse, analysis: origin.analysisSnapshot ?? {},
    } });
  }
  await writeAuditLog(tx, { userId, action: `ai_feedback.${type.toLowerCase()}`, resourceType: 'response_suggestion',
    resourceId: responseId, requestId: request.requestId, metadata: { feedbackId: feedback.id, finalSuggestionId: suggestion.id } });
  return feedback;
}

// Validation is durable even if embedding is temporarily unavailable. Missing
// embeddings are retried before the next generation, with a bounded batch.
export async function indexPendingExamples(brandId) {
  const pending = await prisma.$queryRaw`SELECT id, comment_text AS "commentText" FROM validated_response_examples
    WHERE brand_id = ${brandId}::uuid AND embedding IS NULL ORDER BY created_at LIMIT 5`;
  for (const row of pending) {
    try {
      const vector = await queryEmbedding(row.commentText, 'passage');
      await prisma.$executeRaw`UPDATE validated_response_examples SET embedding = ${vector}::vector,
        embedding_model = ${EMBEDDING_MODEL} WHERE id = ${row.id}::uuid AND brand_id = ${brandId}::uuid AND embedding IS NULL`;
    } catch { break; }
  }
}

export async function feedbackStats(brandId) {
  const rows = await prisma.responseSuggestion.findMany({
    where: { generatedByAi: true, comment: { socialAccount: { brandId } } },
    select: { confidenceScore: true, analysisSnapshot: true, durationMs: true, strategy: true, feedback: true },
  });
  const result = { generated: rows.length, accepted: 0, edited: 0, rejected: 0, regenerated: 0,
    acceptanceRate: 0, editRate: 0, rejectionRate: 0, averageConfidence: null, averageEditDistance: null,
    averageDurationMs: null, averageRating: null, sentiments: {}, intents: {}, strategies: {} };
  const confidence = [], distances = [], durations = [], ratings = [];
  for (const row of rows) {
    const type = row.feedback?.feedbackType?.toLowerCase();
    if (type) result[type] += 1;
    if (row.confidenceScore != null) confidence.push(row.confidenceScore);
    if (row.feedback?.editDistance != null) distances.push(row.feedback.editDistance);
    if (row.feedback?.rating != null) ratings.push(row.feedback.rating);
    if (row.durationMs != null) durations.push(row.durationMs);
    for (const [field, target] of [['sentiment', 'sentiments'], ['intent', 'intents']]) {
      const key = row.analysisSnapshot?.[field] ?? 'unknown';
      result[target][key] = (result[target][key] ?? 0) + 1;
    }
    result.strategies[row.strategy] = (result.strategies[row.strategy] ?? 0) + 1;
  }
  const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return { ...result, acceptanceRate: rows.length ? result.accepted / rows.length : 0,
    editRate: rows.length ? result.edited / rows.length : 0, rejectionRate: rows.length ? result.rejected / rows.length : 0,
    averageConfidence: mean(confidence), averageEditDistance: mean(distances), averageDurationMs: mean(durations), averageRating: mean(ratings) };
}

export async function evaluationDataset(brandId, { page, pageSize }) {
  const rows = await prisma.responseSuggestion.findMany({
    where: { generatedByAi: true, comment: { socialAccount: { brandId } } },
    include: { feedback: true, comment: { select: { content: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize,
  });
  return { page, pageSize, items: rows.map((r) => ({ id: r.id, comment: r.comment.content,
    ...r.analysisSnapshot, aiResponse: r.generatedText ?? r.text, finalResponse: r.feedback?.finalResponse ?? null,
    accepted: r.feedback?.feedbackType === 'ACCEPTED', edited: r.feedback?.feedbackType === 'EDITED',
    rejected: r.feedback?.feedbackType === 'REJECTED', confidence: r.confidenceScore,
    rating: r.feedback?.rating ?? null, strategy: r.strategy, generator: r.generator, durationMs: r.durationMs })) };
}
