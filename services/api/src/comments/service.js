import { prisma } from '../db/prisma.js';
import { callAiService } from '../lib/aiServiceClient.js';
import { writeAuditLog } from '../lib/audit.js';
import { HttpError } from '../lib/http.js';
import { callSocialService } from '../lib/socialServiceClient.js';
import { createNotification, notifiableBrandMembers } from '../notifications/service.js';
import {
  latestSuggestion,
  latestSuggestionsFor,
  toPublicSuggestion,
} from '../response-suggestions/service.js';

// graph-api owns comment CONTENT (always sourced from Meta, via webhook or
// backfill sync — see graph-api/db/social_comments_repository.py). Express
// reads these tables directly via Prisma, same "not secret, unlike
// oauth_tokens" reasoning already applied to social_accounts, and only ever
// writes `status` for local moderation actions (ignore/escalate/manual-
// processed) — never content, author, or anything sourced from Meta.

export function authorInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// Batched, not per-comment: one extra query for the whole page/list instead
// of an N+1 join. Only ever resolves to a post Hootly itself published (see
// docs/SPRINT_08_WEBHOOKS_COMMENTAIRES_SYNCHRO.md's documented backfill
// limitation) — a comment on an organic post has no local Publication to
// point at, and falls back to the raw external id / a generic label.
async function resolvePublicationRefs(comments) {
  const pairs = comments
    .filter((comment) => comment.externalPublicationId)
    .map((comment) => ({ socialAccountId: comment.socialAccountId, externalPublicationId: comment.externalPublicationId }));
  if (pairs.length === 0) return new Map();

  const targets = await prisma.publicationTarget.findMany({
    where: { OR: pairs },
    select: { socialAccountId: true, externalPublicationId: true, publication: { select: { id: true, content: true } } },
  });

  const map = new Map();
  for (const target of targets) {
    map.set(`${target.socialAccountId}:${target.externalPublicationId}`, target.publication);
  }
  return map;
}

// `latestAnalysis` est le pointeur de cache porté par social_comments (voir
// schema.prisma) : toujours la dernière ligne de comment_analyses, jamais une
// valeur recopiée. Un commentaire jamais analysé le laisse à null, ce que le
// mobile affiche comme « analyse en attente » — jamais une analyse inventée.
export function toPublicAnalysis(analysis) {
  if (!analysis) return null;
  return {
    sentiment: analysis.sentiment.toLowerCase(),
    intent: analysis.intent.toLowerCase(),
    priority: analysis.priority.toLowerCase(),
    confidence: analysis.confidence,
    lowConfidence: analysis.lowConfidence,
    urgent: analysis.isUrgent,
    sensitive: analysis.isSensitive,
    recommendedAction: analysis.recommendedAction,
    explanation: analysis.explanation,
    analysedAt: analysis.analysedAt.toISOString(),
    modelVersion: analysis.modelVersion,
  };
}

function toPublicComment(comment, publicationRefs, suggestions = new Map()) {
  const publication = comment.externalPublicationId
    ? publicationRefs.get(`${comment.socialAccountId}:${comment.externalPublicationId}`)
    : null;

  return {
    id: comment.id,
    network: comment.socialAccount.provider.toLowerCase(),
    authorName: comment.authorName ?? 'Auteur inconnu',
    authorInitials: authorInitials(comment.authorName),
    text: comment.content ?? '',
    publishedAt: (comment.metaCreatedAt ?? comment.createdAt).toISOString(),
    publicationId: publication?.id ?? comment.externalPublicationId ?? '',
    publicationTitle: publication?.content?.slice(0, 80) ?? `Publication ${comment.socialAccount.provider.toLowerCase()}`,
    status: comment.status.toLowerCase(),
    isNew: comment.status === 'NEW',
    deletedOnPlatform: comment.isDeletedOnPlatform,
    analysis: toPublicAnalysis(comment.latestAnalysis),
    response: toPublicSuggestion(suggestions.get(comment.id) ?? null),
  };
}

// Une seule définition des `include` : chaque lecture de commentaire doit
// ramener le compte social ET la dernière analyse, sinon `toPublicComment`
// renverrait silencieusement `analysis: null` sur un commentaire analysé.
const COMMENT_INCLUDE = {
  socialAccount: { select: { provider: true } },
  latestAnalysis: true,
};

function accessibleWhere(brandId, filters) {
  // Les filtres IA portent sur la dernière analyse. Un commentaire jamais
  // analysé n'a pas de `latestAnalysis` et sort donc naturellement des
  // résultats dès qu'un de ces filtres est actif — c'est le comportement
  // voulu : « montre-moi les négatifs » ne peut pas inclure des
  // commentaires dont on ignore le sentiment.
  const analysisFilters = {
    ...(filters.sentiment && filters.sentiment !== 'all' ? { sentiment: filters.sentiment.toUpperCase() } : {}),
    ...(filters.priority && filters.priority !== 'all' ? { priority: filters.priority.toUpperCase() } : {}),
    ...(filters.intent && filters.intent !== 'all' ? { intent: filters.intent.toUpperCase() } : {}),
  };

  return {
    socialAccount: {
      brandId,
      ...(filters.network ? { provider: filters.network.toUpperCase() } : {}),
    },
    ...(filters.status && filters.status !== 'all' ? { status: filters.status.toUpperCase() } : {}),
    ...(filters.publicationId ? { externalPublicationId: filters.publicationId } : {}),
    ...(filters.search ? { content: { contains: filters.search, mode: 'insensitive' } } : {}),
    ...(Object.keys(analysisFilters).length > 0 ? { latestAnalysis: { is: analysisFilters } } : {}),
  };
}

// `CommentPriority` est déclaré LOW, MEDIUM, HIGH : l'ordre d'un type enum
// PostgreSQL suit sa déclaration, donc `desc` remonte bien HIGH en premier.
// `nulls: 'last'` garde les commentaires non analysés après ceux qui le sont
// plutôt qu'en tête (comportement par défaut de PostgreSQL en tri décroissant).
function orderFor(sort) {
  if (sort === 'priority') {
    return [{ latestAnalysis: { priority: { sort: 'desc', nulls: 'last' } } }, { createdAt: 'desc' }];
  }
  return [{ createdAt: 'desc' }];
}

export async function listComments(brandId, filters) {
  const where = accessibleWhere(brandId, filters);
  const [total, records] = await prisma.$transaction([
    prisma.socialComment.count({ where }),
    prisma.socialComment.findMany({
      where,
      include: COMMENT_INCLUDE,
      orderBy: orderFor(filters.sort),
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);

  // Deux lectures groupées pour toute la page, jamais une par commentaire.
  const [publicationRefs, suggestions] = await Promise.all([
    resolvePublicationRefs(records),
    latestSuggestionsFor(records.map((record) => record.id)),
  ]);
  return {
    items: records.map((record) => toPublicComment(record, publicationRefs, suggestions)),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
  };
}

export async function commentsCounts(brandId) {
  const [grouped, highPriority, pendingAiResponses] = await prisma.$transaction([
    prisma.socialComment.groupBy({
      by: ['status'],
      where: { socialAccount: { brandId } },
      _count: { _all: true },
    }),
    // Seuls les commentaires encore à traiter comptent comme prioritaires :
    // un commentaire déjà traité ou ignoré n'a plus à figurer dans un
    // compteur d'alerte, même si son analyse était « high ».
    prisma.socialComment.count({
      where: {
        socialAccount: { brandId },
        status: 'NEW',
        latestAnalysis: { is: { priority: 'HIGH' } },
      },
    }),
    // Propositions en attente d'une décision humaine. `distinct` sur le
    // commentaire : plusieurs versions d'une même proposition ne comptent que
    // pour une seule réponse à traiter.
    prisma.responseSuggestion.findMany({
      where: {
        status: { in: ['PROPOSED', 'EDITED', 'APPROVED'] },
        comment: { socialAccount: { brandId } },
      },
      select: { commentId: true },
      distinct: ['commentId'],
    }),
  ]);
  const byStatus = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));

  return {
    untreated: byStatus.NEW ?? 0,
    highPriority,
    pendingAiResponses: pendingAiResponses.length,
  };
}

export async function getComment(comment) {
  const [publicationRefs, suggestions] = await Promise.all([
    resolvePublicationRefs([comment]),
    latestSuggestionsFor([comment.id]),
  ]);
  return toPublicComment(comment, publicationRefs, suggestions);
}

// Union de toutes les sources : réception (Sprint 08), changements de statut,
// envoi, analyses (Sprint 09) et versions de proposition (Sprint 10). Les huit
// genres prévus côté mobile depuis le Sprint 01 ont désormais tous une source
// réelle.
export async function getCommentHistory(comment) {
  const [statusHistory, sentResponse, analyses, suggestions] = await Promise.all([
    prisma.commentStatusHistory.findMany({
      where: { commentId: comment.id },
      include: { changedByUser: { select: { displayName: true } } },
      orderBy: { changedAt: 'asc' },
    }),
    prisma.sentResponse.findUnique({ where: { commentId: comment.id } }),
    prisma.commentAnalysis.findMany({
      where: { commentId: comment.id },
      include: { requestedByUser: { select: { displayName: true } } },
      orderBy: { analysedAt: 'asc' },
    }),
    prisma.responseSuggestion.findMany({
      where: { commentId: comment.id },
      include: { createdByUser: { select: { displayName: true } } },
      orderBy: { version: 'asc' },
    }),
  ]);

  const SUGGESTION_TITLES = {
    PROPOSED: 'Réponse proposée',
    EDITED: 'Réponse modifiée',
    APPROVED: 'Réponse approuvée',
    REJECTED: 'Proposition rejetée',
    SENT: 'Réponse envoyée',
    FAILED: 'Échec de l’envoi',
  };

  const events = [
    {
      id: `${comment.id}-received`,
      kind: 'comment_received',
      at: (comment.metaCreatedAt ?? comment.createdAt).toISOString(),
      title: 'Commentaire reçu',
    },
    ...statusHistory.map((entry) => ({
      id: entry.id,
      kind: entry.toStatus === 'ESCALATED' ? 'escalated' : 'status_changed',
      at: entry.changedAt.toISOString(),
      title: entry.toStatus === 'ESCALATED' ? 'Commentaire escaladé' : `Statut changé : ${entry.toStatus.toLowerCase()}`,
      detail: entry.note ?? undefined,
      actor: entry.changedByUser?.displayName,
    })),
    ...analyses.map((entry) => ({
      id: entry.id,
      kind: 'ai_analysis',
      at: entry.analysedAt.toISOString(),
      title: `Analyse IA : ${entry.sentiment.toLowerCase()} · priorité ${entry.priority.toLowerCase()}`,
      detail: entry.explanation,
      // Absent quand l'analyse vient de la passe automatique du worker : le
      // mobile n'affiche alors simplement pas d'auteur.
      actor: entry.requestedByUser?.displayName,
      modelVersion: entry.modelVersion,
    })),
    ...suggestions.map((entry) => ({
      id: entry.id,
      // Le genre distingue la proposition initiale de ses reprises : c'est ce
      // que l'écran d'historique utilise pour afficher un diff.
      kind: entry.version === 1 && entry.generatedByAi ? 'response_proposed' : 'response_edited',
      at: entry.createdAt.toISOString(),
      title: SUGGESTION_TITLES[entry.status] ?? 'Proposition mise à jour',
      body: entry.text,
      actor: entry.createdByUser?.displayName,
      version: entry.version,
    })),
  ];

  if (sentResponse) {
    events.push(
      sentResponse.status === 'SUCCEEDED'
        ? {
            id: sentResponse.id,
            kind: 'response_sent',
            at: (sentResponse.finishedAt ?? sentResponse.startedAt).toISOString(),
            title: 'Réponse envoyée',
            body: sentResponse.content,
          }
        : {
            id: sentResponse.id,
            kind: 'send_failed',
            at: (sentResponse.finishedAt ?? sentResponse.startedAt).toISOString(),
            title: 'Échec de l’envoi',
            detail: sentResponse.errorMessage ?? undefined,
          }
    );
  }

  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

// Local-only status transitions (ignore/escalate/manual-processed) — never
// calls graph-api or Meta. Mirrors graph-api's own social_comments_repository
// ::set_status (read old status, write new status + append history, one
// transaction) — same semantics, implemented separately per language, same
// as PublicationTarget.status already has two independent writers (Express
// claims PENDING→SENDING, the worker resolves SENDING→SENT/FAILED).
export async function setCommentStatus({ userId, comment, toStatus, note }, request) {
  const upper = toStatus.toUpperCase();
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.socialComment.update({
      where: { id: comment.id },
      data: { status: upper },
      include: COMMENT_INCLUDE,
    });
    await tx.commentStatusHistory.create({
      data: { commentId: comment.id, fromStatus: comment.status, toStatus: upper, changedByUserId: userId, note },
    });
    return fresh;
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'comment.status_changed',
    resourceType: 'social_comment',
    resourceId: comment.id,
    requestId: request.requestId,
    metadata: { fromStatus: comment.status, toStatus: upper },
  });

  return getComment(updated);
}

// "Sync now" (mobile's pull-to-refresh on the inbox) — the real backfill
// already runs automatically every 15 minutes (services/worker/src/
// comment-sync.js), so this triggers the exact same graph-api call on
// demand for every connected account of the brand, rather than exposing a
// separate mechanism. Same limitation as the automatic backfill: only
// covers posts Hootly itself published (see the Sprint 08 doc) — an
// account with nothing published is silently skipped, not an error.
export async function syncBrandComments(brandId) {
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId, status: { in: ['CONNECTED', 'EXPIRING'] } },
  });

  let synced = 0;
  for (const account of accounts) {
    const targets = await prisma.publicationTarget.findMany({
      where: { socialAccountId: account.id, externalPublicationId: { not: null } },
      select: { externalPublicationId: true },
      distinct: ['externalPublicationId'],
    });
    if (targets.length === 0) continue;

    // A single failing account (most likely token_expired) stops the whole
    // action — the mobile screen's catch-all only shows one generic
    // "reconnect an account" message, it doesn't handle partial results.
    await callSocialService('/internal/v1/comments/sync', {
      scope: 'social:read',
      body: {
        socialAccountId: account.id,
        provider: account.provider.toLowerCase(),
        publicationExternalIds: targets.map((target) => target.externalPublicationId),
      },
    });
    synced += 1;
  }

  return { syncedAccounts: synced };
}

// A comment has at most one successful reply, ever — a deterministic,
// comment-scoped idempotency key is the semantically correct choice here,
// not a client-supplied one (unlike publications/routes.js's `withIdempotency`,
// built for actions with a genuine multi-attempt lifecycle like publish/retry).
// graph-api holds the REAL exactly-once guard (a claimed sent_responses row,
// reserved before it ever calls Meta) — this key only lets a legitimate
// Express-side retry (e.g. a dropped connection) replay the same response
// instead of asking graph-api to check its own claim table twice.
export async function replyToComment({ userId, comment }, request) {
  // Le garde-fou central du Sprint 10 : rien ne part sans une proposition
  // explicitement approuvée par un humain. Le texte envoyé est celui de la
  // version approuvée, jamais un texte libre venu de la requête — sinon
  // l'approbation ne porterait que sur un brouillon et n'importe quel autre
  // contenu pourrait être publié derrière elle.
  const suggestion = await latestSuggestion(comment.id);
  if (!suggestion) {
    throw new HttpError(
      409,
      'conflict',
      'Aucune réponse à envoyer : rédigez ou générez une proposition, puis approuvez-la.'
    );
  }
  if (suggestion.status !== 'APPROVED') {
    throw new HttpError(
      409,
      'conflict',
      'Cette réponse doit être approuvée avant d’être envoyée.'
    );
  }

  let result;
  try {
    result = await callSocialService('/internal/v1/comments/reply', {
      scope: 'social:write',
      idempotencyKey: `comment-reply:${comment.id}`,
      body: { commentId: comment.id, userId, text: suggestion.text },
    });
  } catch (error) {
    // L'échec est enregistré sur la proposition : sans ça, une réponse
    // refusée par Meta resterait « approuvée » et l'écran laisserait croire
    // qu'elle est partie.
    //
    // Sauf sur un 409 : graph-api le renvoie quand la réponse est DÉJÀ partie
    // (rejeu de la clé d'idempotence, ou commentaire supprimé entre-temps).
    // Marquer « échec » un envoi réussi serait un mensonge plus grave que
    // l'erreur affichée.
    if (error?.status !== 409) {
      await prisma.responseSuggestion.update({
        where: { id: suggestion.id },
        data: { status: 'FAILED' },
      });
    }
    throw error;
  }

  await prisma.responseSuggestion.update({
    where: { id: suggestion.id },
    data: { status: 'SENT' },
  });

  await writeAuditLog(prisma, {
    userId,
    action: 'comment.reply_sent',
    resourceType: 'social_comment',
    resourceId: comment.id,
    requestId: request.requestId,
    metadata: {
      externalReplyId: result.externalReplyId,
      suggestionId: suggestion.id,
      suggestionVersion: suggestion.version,
      approvedByUserId: suggestion.approvedByUserId,
    },
  });

  // graph-api already moved the comment to PROCESSED as part of the same
  // call — re-read rather than assume, since that write happened directly
  // in Postgres, not through this process.
  const fresh = await prisma.socialComment.findUniqueOrThrow({
    where: { id: comment.id },
    include: COMMENT_INCLUDE,
  });
  return getComment(fresh);
}

// Analyse à la demande (bouton « Analyser » / « Réanalyser » de l'écran 18).
// Synchrone, contrairement à la publication : l'écran attend l'analyse en
// retour pour l'afficher immédiatement, et le calcul est un modèle linéaire
// sur quelques centaines de caractères — quelques millisecondes, pas un appel
// réseau vers Meta.
//
// « Réanalyser » n'est pas une route distincte côté service : analyser deux
// fois ajoute simplement une deuxième ligne dans l'historique. Le sprint
// prévoyait `/analyze` et `/reanalyze` ; les garder séparées côté HTTP a du
// sens (l'intention de l'utilisateur diffère, et l'audit le note), mais elles
// ne pouvaient pas diverger dans la logique sans créer deux chemins à tester.
export async function analyzeComment({ userId, comment, reanalysis = false }, request) {
  const text = comment.content?.trim();
  if (!text) {
    throw new HttpError(400, 'validation_failed', 'Ce commentaire ne contient aucun texte à analyser.');
  }

  const result = await callAiService('/internal/v1/comments/analyze', {
    body: { commentId: comment.id, text },
  });
  const analysis = result?.analysis;
  if (!analysis) {
    throw new HttpError(503, 'ai_unavailable', 'Le service d’analyse a renvoyé une réponse vide.');
  }

  // L'insertion et la mise à jour du pointeur `latestAnalysisId` sont dans la
  // même transaction : c'est l'invariant qui rend le pointeur fiable comme
  // cache (voir schema.prisma). Deux analyses concurrentes du même
  // commentaire écrivent chacune leur ligne ; la dernière transaction validée
  // fixe le pointeur, ce qui est exactement le comportement voulu.
  const updated = await prisma.$transaction(async (tx) => {
    const created = await tx.commentAnalysis.create({
      data: {
        commentId: comment.id,
        sentiment: analysis.sentiment.toUpperCase(),
        intent: analysis.intent.toUpperCase(),
        priority: analysis.priority.toUpperCase(),
        confidence: analysis.confidence,
        sentimentConfidence: analysis.sentimentConfidence,
        intentConfidence: analysis.intentConfidence,
        lowConfidence: analysis.lowConfidence,
        isUrgent: analysis.urgent,
        isSensitive: analysis.sensitive,
        language: analysis.language,
        recommendedAction: analysis.recommendedAction,
        explanation: analysis.explanation,
        signals: analysis.signals ?? [],
        topTerms: analysis.topTerms ?? [],
        modelVersion: analysis.modelVersion,
        datasetVersion: analysis.datasetVersion,
        requestedByUserId: userId,
      },
    });
    return tx.socialComment.update({
      where: { id: comment.id },
      data: { latestAnalysisId: created.id },
      include: COMMENT_INCLUDE,
    });
  });

  await writeAuditLog(prisma, {
    userId,
    action: reanalysis ? 'comment.reanalyzed' : 'comment.analyzed',
    resourceType: 'social_comment',
    resourceId: comment.id,
    requestId: request.requestId,
    metadata: {
      sentiment: analysis.sentiment,
      intent: analysis.intent,
      priority: analysis.priority,
      modelVersion: analysis.modelVersion,
    },
  });

  await notifyAnalysisResult({
    brandId: comment.socialAccount.brandId,
    network: comment.socialAccount.provider,
    commentId: comment.id,
    authorName: comment.authorName,
    analysisId: updated.latestAnalysis?.id ?? updated.latestAnalysisId,
    analysis,
    // L'analyse à la demande a un acteur qui voit déjà le résultat dans la
    // réponse de cette requête — pas de raison de le notifier lui-même.
    excludeUserId: userId,
  });

  return getComment(updated);
}

// Types de notification dérivés d'une analyse (Jour 3) — un commentaire
// « générique » n'a pas son propre type (voir schema.prisma::NotificationType) :
// seuls les signaux qu'une équipe doit effectivement trier en déclenchent
// un, sans quoi chaque commentaire neutre pousserait une alerte. Un même
// commentaire peut déclencher plusieurs types à la fois (urgent ET négatif,
// par exemple) : ce sont deux alertes distinctes, chacune avec son propre
// réglage de préférence côté utilisateur.
export function notificationTypesForAnalysis(analysis) {
  // `analysis` ici est la réponse brute d'ai-service (minuscules — voir
  // callAiService plus haut dans analyzeComment), pas la ligne Prisma déjà
  // mise en majuscules : comparer en minuscules, pas la même convention que
  // `comment_analyses.priority` en base.
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

// N'est appelée qu'ici (analyse à la demande, dans ce process Express). Le
// balayage automatique du worker (services/worker/src/comment-analysis.js)
// tourne dans un AUTRE service et atteint la même destination par
// `POST /internal/v1/notifications` — pas cette fonction directement — mais
// avec le même vocabulaire de type/titre et le même schéma de `eventId`
// (`comment-analysis:{analysisId}:{type}`), pour qu'un commentaire signalé
// se lise pareil qu'il ait été analysé manuellement ou par le balayage.
async function notifyAnalysisResult({ brandId, network, commentId, authorName, analysisId, analysis, excludeUserId }) {
  const types = notificationTypesForAnalysis(analysis);
  if (types.length === 0 || !analysisId) return;

  const recipients = await notifiableBrandMembers(brandId, { excludeUserId });
  for (const type of types) {
    for (const recipientId of recipients) {
      await createNotification({
        userId: recipientId,
        brandId,
        type,
        priority: analysis.priority.toUpperCase(),
        title: ANALYSIS_NOTIFICATION_TITLES[type],
        message: authorName
          ? `${authorName} — ${analysis.explanation}`
          : analysis.explanation,
        network,
        resourceType: 'COMMENT',
        resourceId: commentId,
        eventId: `comment-analysis:${analysisId}:${type}`,
      });
    }
  }
}
