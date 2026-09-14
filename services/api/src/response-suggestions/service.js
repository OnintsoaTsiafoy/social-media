import { prisma } from '../db/prisma.js';
import { callAiService } from '../lib/aiServiceClient.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';
import { createNotification, notifiableBrandMembers } from '../notifications/service.js';
import { queryEmbedding, retrieve, similarExamples } from '../knowledge/service.js';
import { indexPendingExamples, lockComment, recordFeedback } from '../ai-feedback/service.js';

// Nombre d'échanges précédents transmis au service de génération. Volontairement
// bas : « inclure trop d'historique sensible » est un risque explicite du
// sprint, et au-delà de quelques messages le contexte utile n'augmente plus.
const HISTORY_LIMIT = 5;

export function toPublicSuggestion(suggestion) {
  if (!suggestion) return null;
  return {
    id: suggestion.id,
    text: suggestion.text,
    language: suggestion.language,
    tone: suggestion.tone.toLowerCase(),
    status: suggestion.status.toLowerCase(),
    createdAt: suggestion.createdAt.toISOString(),
    generatedByAi: suggestion.generatedByAi,
    originalText: suggestion.originalText,
    version: suggestion.version,
    warnings: suggestion.warnings ?? [],
    blocked: suggestion.blocked,
    generator: suggestion.generator,
    promptVersion: suggestion.promptVersion,
    generatedText: suggestion.generatedText ?? suggestion.originalText,
    finalText: suggestion.finalText ?? null,
    confidenceScore: suggestion.confidenceScore ?? null,
    sources: (suggestion.sources ?? []).map(({ documentId, chunkId, title, score, revision }) => ({ documentId, chunkId, title, score, revision })),
    similarExamples: (suggestion.similarExamples ?? []).map(({ id, score }) => ({ id, score })),
    feedbackStatus: suggestion.feedback?.feedbackType ?? (suggestion.approvedAt
      ? ((suggestion.generatedText ?? suggestion.text) === suggestion.text ? 'ACCEPTED' : 'EDITED') : null),
    strategy: suggestion.strategy ?? 'llm',
  };
}

/** Dernière version d'un commentaire, ou null. */
export async function latestSuggestion(commentId) {
  return prisma.responseSuggestion.findFirst({
    where: { commentId },
    orderBy: { version: 'desc' },
    include: { feedback: true },
  });
}

/** Lecture groupée pour une page de commentaires — un seul aller-retour, pas
 * un N+1 (même idiome que `resolvePublicationRefs`). */
export async function latestSuggestionsFor(commentIds) {
  if (commentIds.length === 0) return new Map();
  const rows = await prisma.responseSuggestion.findMany({
    where: { commentId: { in: commentIds } },
    orderBy: { version: 'desc' },
    include: { feedback: true },
  });
  const map = new Map();
  for (const row of rows) {
    // `orderBy version desc` + premier gagnant = la dernière version par
    // commentaire, sans regroupement côté base.
    if (!map.has(row.commentId)) map.set(row.commentId, row);
  }
  return map;
}

async function brandContext(brandId) {
  const settings = await prisma.brandAiSetting.findFirst({
    where: { brandId },
    orderBy: { version: 'desc' },
  });
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } });

  // Une marque sans réglages IA enregistrés reste utilisable : le service
  // applique alors ses propres valeurs par défaut plutôt que d'échouer.
  if (!settings) return { name: brand?.name ?? null };

  return {
    name: brand?.name ?? null,
    tone: settings.tone.toLowerCase(),
    customTone: settings.customTone,
    formality: settings.formality.toLowerCase(),
    language: settings.language,
    emojisAllowed: settings.emojisAllowed,
    targetLength: settings.targetLength,
    greeting: settings.greeting,
    closing: settings.closing,
    forbiddenTerms: settings.forbiddenTerms ?? [],
    recommendedTerms: settings.recommendedTerms ?? [],
    instructions: settings.instructions,
    complaintInstructions: settings.complaintInstructions,
    urgencyInstructions: settings.urgencyInstructions,
    supportInstructions: settings.supportInstructions,
  };
}

async function publicationContext(comment) {
  if (!comment.externalPublicationId) return null;
  const target = await prisma.publicationTarget.findFirst({
    where: {
      socialAccountId: comment.socialAccountId,
      externalPublicationId: comment.externalPublicationId,
    },
    select: { publication: { select: { content: true, hashtags: true } } },
  });
  if (!target?.publication) return null;
  return { content: target.publication.content ?? '', hashtags: target.publication.hashtags ?? [] };
}

// Only actually sent messages enter conversation history. Rejected drafts
// must never look like previous brand replies to the generator.
async function historyContext(commentId) {
  const previous = await prisma.responseSuggestion.findMany({
    where: { commentId, status: 'SENT' },
    orderBy: { version: 'desc' },
    take: HISTORY_LIMIT,
  });
  return previous
    .reverse()
    .map((entry) => ({ author: 'marque', text: entry.text }));
}

async function safetyCheck({ text, brand, language }) {
  const result = await callAiService('/internal/v1/responses/safety-check', {
    scope: 'ai:generate',
    body: { text, brand, language },
  });
  return { warnings: result?.warnings ?? [], blocked: Boolean(result?.blocked) };
}

/** Génère une proposition, ou enregistre celle rédigée par l'humain. */
export async function createSuggestion({ userId, comment, text, tone, language, instruction, strategy = 'rag_feedback', expectedSuggestionId }, request) {
  const started = Date.now();
  const brandId = comment.socialAccount.brandId;
  const brand = await brandContext(brandId);
  const resolvedLanguage = language ?? brand.language ?? 'fr';
  const initial = await latestSuggestion(comment.id);
  if (initial?.status === 'SENT') throw new HttpError(409, 'conflict', 'Une réponse a déjà été envoyée.');
  if (expectedSuggestionId && initial?.id !== expectedSuggestionId) throw new HttpError(409, 'conflict', 'Rechargez la dernière proposition.');
  if (text && initial) return updateSuggestion({ userId, comment, suggestion: initial, text, tone, language }, request);
  let documents = [], examples = [], confidenceScore = null, analysisSnapshot = {};

  let payload;
  if (text) {
    // Rédigée à la main : rien à générer, mais le contrôle s'applique quand
    // même — c'est le chemin par lequel un engagement non autorisé arrive le
    // plus souvent.
    const safety = await safetyCheck({ text, brand, language: resolvedLanguage });
    payload = {
      text,
      language: resolvedLanguage,
      tone: tone ?? brand.tone ?? 'professional',
      generatedByAi: false,
      generator: 'human',
      promptVersion: 'human',
      warnings: safety.warnings,
      blocked: safety.blocked,
    };
  } else {
    const [publication, history] = await Promise.all([
      publicationContext(comment),
      historyContext(comment.id),
    ]);
    if (strategy !== 'llm') {
      await indexPendingExamples(brandId);
      const vector = await queryEmbedding(comment.content ?? '');
      const context = await retrieve({ userId, brandId, query: comment.content ?? '', vector });
      documents = context.results;
      confidenceScore = context.confidenceScore;
      if (strategy === 'rag_feedback') examples = await similarExamples({ brandId, vector, excludeCommentId: comment.id });
    }
    const result = await callAiService('/internal/v1/responses/generate', {
      scope: 'ai:generate',
      body: {
        commentId: comment.id,
        commentText: comment.content ?? '',
        authorName: comment.authorName,
        brand,
        publication,
        history,
        instruction,
        tone,
        language,
        documents,
        examples,
        strategy,
      },
    });
    const suggestion = result?.suggestion;
    analysisSnapshot = result?.analysis ?? {};
    if (!suggestion) {
      throw new HttpError(503, 'ai_unavailable', 'Le service d’analyse a renvoyé une réponse vide.');
    }
    payload = {
      text: suggestion.text,
      language: suggestion.language,
      tone: suggestion.tone,
      generatedByAi: true,
      generator: suggestion.generator,
      promptVersion: suggestion.promptVersion,
      warnings: suggestion.warnings ?? [],
      blocked: Boolean(suggestion.blocked),
    };
  }

  const created = await prisma.$transaction(async (tx) => {
    await lockComment(tx, comment.id);
    const previous = await tx.responseSuggestion.findFirst({ where: { commentId: comment.id }, orderBy: { version: 'desc' } });
    if ((previous?.id ?? null) !== (initial?.id ?? null) || previous?.status === 'SENT') {
      throw new HttpError(409, 'conflict', 'Une nouvelle version existe. Rechargez la réponse.');
    }
    if (previous && !text) {
      const rootId = previous.generationId ?? (previous.generatedByAi ? previous.id : null);
      const verdict = rootId ? await tx.aiFeedback.findUnique({ where: { responseId: rootId } }) : null;
      if (rootId && !verdict) {
        await recordFeedback(tx, { suggestion: previous, comment, userId, type: 'REGENERATED' }, request);
        await tx.responseSuggestion.update({ where: { id: previous.id }, data: { status: 'REJECTED' } });
      }
    }
    return tx.responseSuggestion.create({ data: {
      commentId: comment.id,
      version: (previous?.version ?? 0) + 1,
      text: payload.text,
      // Preserve both the first proposal and this generation's exact output.
      originalText: previous?.originalText ?? payload.text,
      generatedText: payload.generatedByAi ? payload.text : null,
      confidenceScore,
      sources: documents,
      similarExamples: examples,
      analysisSnapshot,
      strategy: payload.generatedByAi ? strategy : 'human',
      durationMs: Date.now() - started,
      language: payload.language,
      tone: payload.tone.toUpperCase(),
      status: payload.generatedByAi ? 'PROPOSED' : 'EDITED',
      generatedByAi: payload.generatedByAi,
      generator: payload.generator,
      promptVersion: payload.promptVersion,
      warnings: payload.warnings,
      blocked: payload.blocked,
      instruction: instruction ?? null,
      createdByUserId: userId,
    } });
  });

  await writeAuditLog(prisma, {
    userId,
    action: payload.generatedByAi ? 'response_suggestion.generated' : 'response_suggestion.drafted',
    resourceType: 'response_suggestion',
    resourceId: created.id,
    requestId: request.requestId,
    metadata: { commentId: comment.id, generator: payload.generator, blocked: payload.blocked },
  });

  // Notifie les AUTRES community managers de la marque : celui qui vient de
  // générer la proposition la voit déjà dans la réponse de cette requête —
  // le notifier de sa propre action serait redondant. Une réponse rédigée à
  // la main n'est pas une génération : rien à annoncer.
  if (payload.generatedByAi) {
    const recipients = await notifiableBrandMembers(brandId, { excludeUserId: userId });
    for (const recipientId of recipients) {
      await createNotification({
        userId: recipientId,
        brandId,
        type: 'AI_RESPONSE_READY',
        priority: 'MEDIUM',
        title: 'Réponse IA à valider',
        message: comment.authorName
          ? `Une proposition de réponse a été générée pour le commentaire de ${comment.authorName}.`
          : 'Une proposition de réponse a été générée pour un commentaire.',
        resourceType: 'COMMENT',
        resourceId: comment.id,
        eventId: `response-suggestion:${created.id}`,
      });
    }
  }

  return toPublicSuggestion(created);
}

/** Une édition crée une nouvelle version : rien n'est jamais écrasé. */
export async function updateSuggestion({ userId, comment, suggestion, text, tone, language }, request) {
  const brand = await brandContext(comment.socialAccount.brandId);
  const resolvedLanguage = language ?? suggestion.language;
  const safety = await safetyCheck({ text, brand, language: resolvedLanguage });

  const created = await prisma.$transaction(async (tx) => {
    await lockComment(tx, comment.id);
    const current = await tx.responseSuggestion.findFirst({ where: { commentId: comment.id }, orderBy: { version: 'desc' } });
    if (current?.id !== suggestion.id || !['PROPOSED', 'EDITED'].includes(current.status)) {
      throw new HttpError(409, 'conflict', 'Cette version ne peut plus être modifiée. Régénérez une proposition.');
    }
    return tx.responseSuggestion.create({ data: {
      commentId: comment.id,
      version: current.version + 1,
      text,
      originalText: suggestion.originalText,
      generatedText: suggestion.generatedText ?? (suggestion.generatedByAi ? suggestion.text : null),
      generationId: suggestion.generationId ?? (suggestion.generatedByAi ? suggestion.id : null),
      confidenceScore: suggestion.confidenceScore,
      sources: suggestion.sources ?? [],
      similarExamples: suggestion.similarExamples ?? [],
      analysisSnapshot: suggestion.analysisSnapshot ?? {},
      strategy: suggestion.strategy,
      language: resolvedLanguage,
      tone: (tone ?? suggestion.tone.toLowerCase()).toUpperCase(),
      status: 'EDITED',
      generatedByAi: false,
      generator: suggestion.generator,
      promptVersion: suggestion.promptVersion,
      warnings: safety.warnings,
      blocked: safety.blocked,
      instruction: suggestion.instruction,
      createdByUserId: userId,
    } });
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'response_suggestion.edited',
    resourceType: 'response_suggestion',
    resourceId: created.id,
    requestId: request.requestId,
    metadata: { commentId: comment.id, fromVersion: suggestion.version, blocked: safety.blocked },
  });

  return toPublicSuggestion(created);
}

/** Approbation humaine — le seul chemin qui autorise un envoi. */
export async function approveSuggestion({ userId, comment, suggestion, text, reason, rating, feedbackComment }, request) {
  let target = suggestion;

  // Retouche de dernière minute : enregistrée comme une version à part entière
  // avant approbation, pour que le texte approuvé soit exactement celui qui
  // partira.
  if (text && text !== suggestion.text) {
    const updated = await updateSuggestion(
      { userId, comment, suggestion, text, tone: undefined, language: undefined },
      request
    );
    target = await prisma.responseSuggestion.findUniqueOrThrow({ where: { id: updated.id } });
  }

  if (target.blocked) {
    throw new HttpError(
      409,
      'conflict',
      'Cette réponse ne peut pas être approuvée : le contrôle de sécurité a relevé un problème bloquant.',
      target.warnings
    );
  }
  if (['SENT', 'REJECTED'].includes(target.status)) {
    throw new HttpError(409, 'conflict', 'Cette proposition a déjà été traitée.');
  }

  const approved = await prisma.$transaction(async (tx) => {
    await lockComment(tx, comment.id);
    const current = await tx.responseSuggestion.findFirst({ where: { commentId: comment.id }, orderBy: { version: 'desc' } });
    if (current?.id !== target.id || !['PROPOSED', 'EDITED', 'APPROVED', 'FAILED'].includes(current.status)) {
      throw new HttpError(409, 'conflict', 'Cette version ne peut plus être approuvée.');
    }
    if (current.status === 'APPROVED') return current;
    const type = (target.generatedText ?? target.text) === target.text ? 'ACCEPTED' : 'EDITED';
    await recordFeedback(tx, { suggestion: target, comment, userId, type, finalResponse: target.text, reason, rating, feedbackComment }, request);
    return tx.responseSuggestion.update({
      where: { id: target.id },
      data: { status: 'APPROVED', approvedByUserId: userId, approvedAt: new Date(), finalText: target.text },
    });
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'response_suggestion.approved',
    resourceType: 'response_suggestion',
    resourceId: approved.id,
    requestId: request.requestId,
    metadata: { commentId: comment.id, version: approved.version },
  });

  return toPublicSuggestion(approved);
}

export async function rejectSuggestion({ userId, comment, suggestion, reason, rating, feedbackComment }, request) {
  if (suggestion.status === 'SENT') {
    throw new HttpError(409, 'conflict', 'Cette réponse a déjà été envoyée.');
  }

  const rejected = await prisma.$transaction(async (tx) => {
    await lockComment(tx, comment.id);
    const current = await tx.responseSuggestion.findFirst({ where: { commentId: comment.id }, orderBy: { version: 'desc' } });
    if (current?.id !== suggestion.id || !['PROPOSED', 'EDITED', 'REJECTED'].includes(current.status)) {
      throw new HttpError(409, 'conflict', 'Cette proposition a déjà été traitée.');
    }
    if (current.status === 'REJECTED') return current;
    await recordFeedback(tx, { suggestion: current, comment, userId, type: 'REJECTED', reason, rating, feedbackComment }, request);
    return tx.responseSuggestion.update({ where: { id: suggestion.id }, data: { status: 'REJECTED' } });
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'response_suggestion.rejected',
    resourceType: 'response_suggestion',
    resourceId: rejected.id,
    requestId: request.requestId,
    metadata: { commentId: comment.id, reason: reason ?? null },
  });

  return toPublicSuggestion(rejected);
}

export async function listSuggestions(commentId) {
  const rows = await prisma.responseSuggestion.findMany({
    where: { commentId },
    orderBy: { version: 'asc' },
    include: { feedback: true },
  });
  return rows.map(toPublicSuggestion);
}

export async function generateHashtags({ brandId, text, preserve }) {
  const brand = await brandContext(brandId);
  const result = await callAiService('/internal/v1/hashtags/generate', {
    scope: 'ai:generate',
    body: { text, brand, preserve: preserve ?? [] },
  });
  return { hashtags: result?.hashtags ?? [], keywords: result?.keywords ?? [] };
}
