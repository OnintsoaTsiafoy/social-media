import { prisma } from '../db/prisma.js';
import { callAiService } from '../lib/aiServiceClient.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';
import { createNotification, notifiableBrandMembers } from '../notifications/service.js';

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
  };
}

/** Dernière version d'un commentaire, ou null. */
export async function latestSuggestion(commentId) {
  return prisma.responseSuggestion.findFirst({
    where: { commentId },
    orderBy: { version: 'desc' },
  });
}

/** Lecture groupée pour une page de commentaires — un seul aller-retour, pas
 * un N+1 (même idiome que `resolvePublicationRefs`). */
export async function latestSuggestionsFor(commentIds) {
  if (commentIds.length === 0) return new Map();
  const rows = await prisma.responseSuggestion.findMany({
    where: { commentId: { in: commentIds } },
    orderBy: { version: 'desc' },
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

// Historique borné au fil de CE commentaire : les propositions déjà rédigées
// et la réponse éventuellement envoyée. Jamais les échanges de l'auteur sur
// d'autres publications.
async function historyContext(commentId) {
  const previous = await prisma.responseSuggestion.findMany({
    where: { commentId, status: { in: ['REJECTED', 'SENT'] } },
    orderBy: { version: 'desc' },
    take: HISTORY_LIMIT,
  });
  return previous
    .reverse()
    .map((entry) => ({ author: 'marque', text: entry.text }));
}

async function nextVersion(commentId) {
  const last = await prisma.responseSuggestion.findFirst({
    where: { commentId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}

// `version` est un compteur monotone protégé par une contrainte unique
// (commentId, version). Deux community managers d'une même marque qui
// génèrent en même temps sur le commentaire calculent le même numéro : le
// second écrirait en violation de contrainte, donc en 500. Un seul nouvel
// essai suffit — le numéro est relu entre-temps.
async function createVersion(data) {
  try {
    return await prisma.responseSuggestion.create({ data });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    return prisma.responseSuggestion.create({
      data: { ...data, version: await nextVersion(data.commentId) },
    });
  }
}

async function safetyCheck({ text, brand, language }) {
  const result = await callAiService('/internal/v1/responses/safety-check', {
    scope: 'ai:generate',
    body: { text, brand, language },
  });
  return { warnings: result?.warnings ?? [], blocked: Boolean(result?.blocked) };
}

/** Génère une proposition, ou enregistre celle rédigée par l'humain. */
export async function createSuggestion({ userId, comment, text, tone, language, instruction }, request) {
  const brandId = comment.socialAccount.brandId;
  const brand = await brandContext(brandId);
  const resolvedLanguage = language ?? brand.language ?? 'fr';

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
        language: resolvedLanguage,
      },
    });
    const suggestion = result?.suggestion;
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

  const previous = await latestSuggestion(comment.id);
  const created = await createVersion({
    commentId: comment.id,
    version: (previous?.version ?? 0) + 1,
    text: payload.text,
    // Première proposition d'un commentaire : c'est elle l'originale. Les
    // versions suivantes reprennent l'originale de la précédente, pour que la
    // proposition d'origine ne soit jamais perdue après une édition ou une
    // régénération.
    originalText: previous?.originalText ?? payload.text,
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

  const created = await createVersion({
    commentId: comment.id,
    version: await nextVersion(comment.id),
    text,
    originalText: suggestion.originalText,
    language: resolvedLanguage,
    tone: (tone ?? suggestion.tone.toLowerCase()).toUpperCase(),
    status: 'EDITED',
    // Le texte a été réécrit par un humain : la mention « généré par l'IA »
    // cesse d'être vraie et l'écran ne doit plus l'afficher.
    generatedByAi: false,
    generator: suggestion.generator,
    promptVersion: suggestion.promptVersion,
    warnings: safety.warnings,
    blocked: safety.blocked,
    instruction: suggestion.instruction,
    createdByUserId: userId,
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
export async function approveSuggestion({ userId, comment, suggestion, text }, request) {
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

  const approved = await prisma.responseSuggestion.update({
    where: { id: target.id },
    data: { status: 'APPROVED', approvedByUserId: userId, approvedAt: new Date() },
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

export async function rejectSuggestion({ userId, comment, suggestion, reason }, request) {
  if (suggestion.status === 'SENT') {
    throw new HttpError(409, 'conflict', 'Cette réponse a déjà été envoyée.');
  }

  const rejected = await prisma.responseSuggestion.update({
    where: { id: suggestion.id },
    data: { status: 'REJECTED' },
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
