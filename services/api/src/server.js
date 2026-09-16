import express from 'express';
import { approvalsRouter, publicationApprovalRouter } from './approvals/routes.js';
import { fileURLToPath } from 'node:url';

import { analyticsRouter } from './analytics/routes.js';
import { aiRouter } from './ai-feedback/routes.js';
import { knowledgeRouter } from './knowledge/routes.js';
import { authRouter } from './auth/routes.js';
import { brandRouter } from './brands/routes.js';
import { commentRouter } from './comments/routes.js';
import { competitorRouter } from './competitors/routes.js';
import { dashboardRouter } from './dashboard/routes.js';
import { mediaRouter } from './media/routes.js';
import { internalNotificationRouter } from './notifications/internal-routes.js';
import { deviceTokenRouter, notificationRouter, notificationSettingsRouter } from './notifications/routes.js';
import { calendarRouter, publicationRouter } from './publications/routes.js';
import { profileRouter } from './profile/routes.js';
import { hashtagRouter, responseSuggestionRouter } from './response-suggestions/routes.js';
import { socialAccountRouter } from './social-accounts/routes.js';
import { addRequestContext, errorHandler, notFoundHandler } from './lib/http.js';
import { stopBoss } from './lib/jobs.js';
import { ensureBucket, isStorageConfigured } from './lib/storage.js';

export const app = express();
const port = Number(process.env.PORT ?? 3000);

const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Hootly Public API',
    version: '0.1.0',
    description: 'API publique Hootly.',
  },
  paths: {
    '/api/v1/analytics/insights': {
      get: { summary: 'Faits, métriques sources, variations et anomalies (brandId, period=7d|30d|90d, network=all|facebook|instagram)' },
      post: { summary: 'COMMUNITY_MANAGER : générer et conserver une analyse, avec repli local' },
    },
    '/api/v1/analytics/insights/history': { get: { summary: 'Historique paginé et filtré des analyses conservées' } },
    '/api/v1/analytics/insights/{insightId}': { get: { summary: 'Analyse historique et instantané des métriques (?brandId=)' } },
    '/api/v1/analytics/insights/{insightId}/feedback': { put: { summary: 'Un avis modifiable par membre : useful, comment facultatif (?brandId=)' } },
    '/api/v1/analytics/insights/feedback/stats': { get: { summary: 'Satisfaction et analyses les plus rejetées pour la marque et les filtres' } },
    '/api/v1/approvals': { get: { summary: 'Demandes des marques administrées, paginées ; filtres brandId, status, authorId, reviewerId' } },
    '/api/v1/approvals/members': { get: { summary: 'Membres et responsables de la marque (brandId obligatoire)' } },
    '/api/v1/publications/{publicationId}/request-approval': { post: { summary: 'Soumettre un brouillon ; reviewerId et comment facultatifs' } },
    '/api/v1/publications/{publicationId}/approve': { post: { summary: 'ADMIN/OWNER : approuver la demande affichée (approvalId obligatoire)' } },
    '/api/v1/publications/{publicationId}/reject': { post: { summary: 'ADMIN/OWNER : refuser (approvalId et comment obligatoires)' } },
    '/api/v1/publications/{publicationId}/request-changes': { post: { summary: 'ADMIN/OWNER : demander des modifications (approvalId et comment obligatoires)' } },
    '/api/v1/publications/{publicationId}/cancel-approval': { post: { summary: 'Annuler la demande et revenir au brouillon (approvalId obligatoire)' } },
    '/api/v1/publications/{publicationId}/approval-history': { get: { summary: 'Historique paginé des actions, acteurs, commentaires et transitions' } },
    '/health': { get: { summary: 'Liveness probe', responses: { 200: { description: 'Process alive' } } } },
    '/ready': { get: { summary: 'Readiness probe', responses: { 200: { description: 'Dependencies configured' }, 503: { description: 'Configuration missing' } } } },
    '/api/v1/auth/register': { post: { summary: 'Créer un compte' } },
    '/api/v1/auth/login': { post: { summary: 'Ouvrir une session' } },
    '/api/v1/auth/refresh': { post: { summary: 'Tourner le refresh token' } },
    '/api/v1/auth/logout': { post: { summary: 'Révoquer la session courante' } },
    '/api/v1/auth/me': { get: { summary: 'Utilisateur courant' } },
    '/api/v1/auth/forgot-password': { post: { summary: 'Demander une réinitialisation' } },
    '/api/v1/auth/reset-password': { post: { summary: 'Réinitialiser un mot de passe' } },
    '/api/v1/auth/change-password': { post: { summary: 'Modifier un mot de passe' } },
    '/api/v1/auth/sessions': {
      get: { summary: 'Lister les sessions actives' },
      delete: { summary: 'Fermer toutes les sessions (y compris la courante)' },
    },
    '/api/v1/auth/sessions/{id}': { delete: { summary: 'Fermer une session précise' } },
    '/api/v1/auth/account': {
      delete: { summary: 'Désactiver le compte (409 si une marque possédée a d’autres membres actifs)' },
    },
    '/api/v1/profile': { get: { summary: 'Lire le profil' }, patch: { summary: 'Modifier le profil' } },
    '/api/v1/profile/preferences': { get: { summary: 'Lire les prÃ©fÃ©rences' }, patch: { summary: 'Modifier les prÃ©fÃ©rences' } },
    '/api/v1/profile/avatar': { post: { summary: 'Associer un avatar' }, delete: { summary: 'Retirer l’avatar' } },
    '/api/v1/brands': { get: { summary: 'Lister les marques autorisÃ©es' }, post: { summary: 'CrÃ©er une marque' } },
    '/api/v1/brands/{brandId}': {
      get: { summary: 'Lire une marque' },
      patch: { summary: 'Modifier une marque' },
      delete: { summary: 'Archiver une marque' },
    },
    '/api/v1/brands/{brandId}/activate': { post: { summary: 'Activer une marque' } },
    '/api/v1/brands/{brandId}/ai-settings': {
      get: { summary: 'Lire les paramÃ¨tres IA' },
      patch: { summary: 'Versionner les paramÃ¨tres IA' },
    },
    '/api/v1/media': { post: { summary: 'Déposer un média (multipart/form-data)' } },
    '/api/v1/media/{mediaId}': {
      get: { summary: 'Métadonnées et URL signée' },
      delete: { summary: 'Supprimer un média inutilisé' },
    },
    '/api/v1/publications': {
      get: { summary: 'Lister les publications de la marque' },
      post: { summary: 'Créer un brouillon' },
    },
    '/api/v1/publications/counts': { get: { summary: 'Compter les publications par statut' } },
    '/api/v1/publications/{publicationId}': {
      get: { summary: 'Détail d’une publication' },
      patch: { summary: 'Modifier une publication non envoyée' },
      delete: { summary: 'Supprimer une publication' },
    },
    '/api/v1/publications/{publicationId}/schedule': {
      post: { summary: 'Planifier une publication' },
      patch: { summary: 'Replanifier une publication' },
      delete: { summary: 'Annuler la planification' },
    },
    '/api/v1/publications/{publicationId}/publish': {
      post: { summary: 'Demander un envoi immédiat (202, exécuté par le worker)' },
    },
    '/api/v1/publications/{publicationId}/retry': {
      post: { summary: 'Relancer les réseaux en échec (202)' },
    },
    '/api/v1/calendar': { get: { summary: 'Publications planifiées ou publiées sur une période' } },
    '/api/v1/social-accounts': {
      get: { summary: 'Lister les comptes sociaux liés à une marque (?brandId=)' },
    },
    '/api/v1/social-accounts/{provider}/connect': {
      post: { summary: 'Démarrer une connexion OAuth Meta (201 → authorizationUrl + oauthState)' },
    },
    '/api/v1/social-accounts/oauth/status': {
      get: { summary: 'Statut d’un state OAuth (PENDING/COMPLETED/EXPIRED)' },
    },
    '/api/v1/social-accounts/{socialAccountId}': {
      delete: { summary: 'Déconnecter un compte social (révoque côté Social, 204)' },
    },
    '/api/v1/social-accounts/{socialAccountId}/sync': {
      post: { summary: 'Revalider la connexion auprès de Meta (409 token_expired si expirée)' },
    },
    '/api/v1/comments': {
      get: { summary: 'Lister les commentaires d’une marque (?brandId=, filtres status/network/publicationId/search)' },
    },
    '/api/v1/comments/counts': {
      get: { summary: 'Compteurs de commentaires par marque (?brandId=)' },
    },
    '/api/v1/comments/sync': {
      post: { summary: 'Synchroniser maintenant (déclenche le même appel que le cron de secours, 409 token_expired si un compte a expiré)' },
    },
    '/api/v1/comments/{commentId}': {
      get: { summary: 'Détail d’un commentaire' },
    },
    '/api/v1/comments/{commentId}/history': {
      get: { summary: 'Historique d’un commentaire (statuts, réponse envoyée/échouée)' },
    },
    '/api/v1/comments/{commentId}/status': {
      patch: { summary: 'Changer le statut localement (processed/ignored/escalated — jamais "new")' },
    },
    '/api/v1/comments/{commentId}/escalate': {
      post: { summary: 'Raccourci pour PATCH status=escalated' },
    },
    '/api/v1/comments/{commentId}/reply': {
      post: { summary: 'Envoyer une réponse (idempotent par commentaire, 409 si déjà envoyée ou commentaire supprimé)' },
    },
    // Correctif adjacent : montées au Sprint 10, jamais reportées ici.
    '/api/v1/response-suggestions': {
      get: { summary: 'Lister toutes les versions d’une proposition (?commentId=)' },
      post: { summary: 'Générer ou rédiger une proposition de réponse' },
    },
    '/api/v1/knowledge': {
      get: { summary: 'Documents personnels de la marque (brandId, page, pageSize)' },
      post: { summary: 'Ajouter et indexer un texte (brandId, title, documentType, content, internal)' },
    },
    '/api/v1/knowledge/upload': { post: { summary: 'Importer PDF/DOCX/TXT/CSV (multipart, 10 Mo maximum)' } },
    '/api/v1/knowledge/{id}': {
      get: { summary: 'Lire un document personnel' },
      put: { summary: 'Modifier et réindexer un document (revision obligatoire)' },
      delete: { summary: 'Supprimer le document et tous ses embeddings' },
    },
    '/api/v1/knowledge/{id}/reindex': { post: { summary: 'Relancer l’indexation de la dernière version' } },
    '/api/v1/ai/retrieve': { post: { summary: 'Top K passages publics personnels de la marque, score cosinus et seuil minimal' } },
    '/api/v1/ai/responses': {
      post: { summary: 'Générer une réponse (commentId, strategy=llm|rag|rag_feedback)' },
      get: { summary: 'Toutes les versions d’un commentaire (commentId)' },
    },
    '/api/v1/ai/responses/{id}': { get: { summary: 'Texte original, version finale, sources et confiance documentaire' } },
    '/api/v1/ai/responses/{id}/accept': { post: { summary: 'Valider sans envoi ; feedback facultatif reason, rating (1–5), feedbackComment' } },
    '/api/v1/ai/responses/{id}/edit': { post: { summary: 'Enregistrer et valider une correction humaine (text obligatoire), sans envoi' } },
    '/api/v1/ai/responses/{id}/reject': { post: { summary: 'Rejeter une génération avec feedback facultatif' } },
    '/api/v1/ai/responses/{id}/regenerate': { post: { summary: 'Nouvelle version, conserve la précédente et sa décision' } },
    '/api/v1/ai/feedback/stats': { get: { summary: 'Compteurs, taux, confiance, sentiment et intention pour brandId' } },
    '/api/v1/ai/feedback/dataset': { get: { summary: 'Export JSON paginé des générations et décisions de la marque' } },
    '/api/v1/response-suggestions/{suggestionId}': {
      get: { summary: 'Détail d’une version' },
      patch: { summary: 'Enregistrer une réécriture humaine (crée une nouvelle version)' },
    },
    '/api/v1/response-suggestions/{suggestionId}/approve': {
      post: { summary: 'Approuver une proposition (seul chemin qui autorise ensuite un envoi)' },
    },
    '/api/v1/response-suggestions/{suggestionId}/reject': {
      post: { summary: 'Rejeter une proposition (409 si déjà envoyée)' },
    },
    '/api/v1/publications/generate-hashtags': {
      post: { summary: 'Proposer des hashtags pour un texte de publication' },
    },
    '/api/v1/notifications': {
      get: { summary: 'Lister les notifications de l’utilisateur connecté (?filter=all|unread|priority|errors, pagination)' },
    },
    '/api/v1/notifications/unread-count': {
      get: { summary: 'Compteur de notifications non lues' },
    },
    '/api/v1/notifications/{notificationId}/read': {
      patch: { summary: 'Marquer une notification comme lue (idempotent)' },
    },
    '/api/v1/notifications/read-all': {
      post: { summary: 'Marquer toutes les notifications non lues comme lues' },
    },
    '/api/v1/device-tokens': {
      post: { summary: 'Enregistrer ou renouveler un token FCM pour l’appareil courant' },
      delete: { summary: 'Désassocier un token FCM (déconnexion) — le token voyage dans le corps' },
    },
    '/api/v1/notification-settings': {
      get: { summary: 'Lire les préférences de notification (valeurs par défaut si aucune n’a encore été enregistrée)' },
      patch: { summary: 'Modifier les préférences de notification (crée la ligne au besoin)' },
    },
    '/api/v1/analytics/sync': {
      post: {
        summary:
          'Déclencher une synchronisation des métriques pour une marque (?brandId= dans le corps) — enqueue un job pg-boss, ne bloque jamais sur graph-api, 202 immédiat',
      },
    },
    '/api/v1/analytics/summary': {
      get: { summary: 'Totaux et deltas pour une marque (?brandId=, period=7d|30d|90d, network=all|facebook|instagram)' },
    },
    '/api/v1/analytics/timeline': {
      get: { summary: 'Interactions par réseau, 4 semaines glissantes fixes (?brandId=, network) — ignore period' },
    },
    '/api/v1/analytics/top-publications': {
      get: { summary: 'Publications les plus engageantes de la période (?brandId=, period, network, limit)' },
    },
    '/api/v1/analytics/networks-comparison': {
      get: { summary: 'Mêmes totaux que /summary, ventilés par réseau (?brandId=, period, network)' },
    },
    '/api/v1/analytics/sentiments': {
      get: { summary: 'Répartition des commentaires par sentiment sur la période (?brandId=, period, network)' },
    },
    '/api/v1/analytics/priorities': {
      get: { summary: 'Répartition des commentaires par priorité sur la période (?brandId=, period, network)' },
    },
    '/api/v1/analytics/publications/{publicationId}': {
      get: { summary: 'Détail analytics d’une publication (?brandId=) — métriques par réseau, sentiment/urgence des commentaires, réponses IA' },
    },
    '/api/v1/analytics/best-times': {
      get: {
        summary:
          'Les 3 meilleurs créneaux jour/tranche horaire pour publier, un réseau à la fois (?brandId=, network=facebook|instagram, period, timezone) — score, niveau de confiance, échantillon',
      },
    },
    '/api/v1/analytics/best-times/explain': {
      post: {
        summary:
          'Explication IA courte du meilleur créneau (mêmes paramètres que /best-times, dans le corps) — faits recalculés côté serveur, jamais fournis par le client',
      },
    },
    '/api/v1/competitors': {
      get: { summary: 'Concurrents suivis par la marque (?brandId=, platform, status, pagination)' },
      post: { summary: 'COMMUNITY_MANAGER : ajouter un concurrent (brandId, platform, handle URL ou nom d’utilisateur)' },
    },
    '/api/v1/competitors/verify': {
      post: { summary: 'COMMUNITY_MANAGER : vérifier un compte auprès de Meta sans l’enregistrer' },
    },
    '/api/v1/competitors/comparison': {
      get: { summary: 'Comparaison marque / concurrents (?brandId=, period, platform, limit) — métriques calculées à l’identique des deux côtés' },
    },
    '/api/v1/competitors/comparison/explain': {
      post: { summary: 'Résumé IA de la comparaison — faits recalculés côté serveur, chiffres inventés rejetés' },
    },
    '/api/v1/competitors/{competitorId}': {
      get: { summary: 'Détail d’un concurrent (?brandId=)' },
      patch: { summary: 'COMMUNITY_MANAGER : renommer localement ou corriger le nom d’utilisateur suivi' },
      delete: { summary: 'COMMUNITY_MANAGER : retirer un concurrent (204, publications et relevés en cascade)' },
    },
    '/api/v1/competitors/{competitorId}/sync': {
      post: { summary: 'COMMUNITY_MANAGER : demander une synchronisation (202, exécutée par le worker)' },
    },
    '/api/v1/competitors/{competitorId}/posts': {
      get: { summary: 'Publications collectées du concurrent (?brandId=, period, pagination)' },
    },
    '/api/v1/competitors/{competitorId}/analytics': {
      get: { summary: 'Indicateurs du concurrent sur la période (?brandId=, period) — fréquence, moyennes, évolution, top publications' },
    },
    '/api/v1/dashboard/summary': {
      get: { summary: 'Compteurs agrégés pour l’écran d’accueil (?brandId=) — recompose comments/service.js::commentsCounts' },
    },
    '/api/v1/dashboard/priority-comments': {
      get: { summary: 'Les 3 commentaires prioritaires non traités (?brandId=)' },
    },
    '/api/v1/dashboard/upcoming-publications': {
      get: { summary: 'Les 3 prochaines publications planifiées (?brandId=)' },
    },
  },
};

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(addRequestContext);

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'api' });
});

app.get('/ready', (_request, response) => {
  // Le stockage média devient une dépendance de l'API au Sprint 04 : sans lui,
  // la création d'une publication avec image échouerait silencieusement.
  const required = ['DATABASE_URL', 'SOCIAL_SERVICE_URL', 'AI_SERVICE_URL', 'JWT_ACCESS_SECRET', 'S3_ENDPOINT', 'MEDIA_BUCKET'];
  const missing = required.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    response.status(503).json({
      status: 'not_ready',
      service: 'api',
      reason: 'configuration_missing',
      missing,
    });
    return;
  }

  response.status(200).json({ status: 'ready', service: 'api' });
});

app.get('/openapi.json', (_request, response) => {
  response.status(200).json(openApiDocument);
});

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/profile', profileRouter);
app.use('/api/v1/brands', brandRouter);
app.use('/api/v1/media', mediaRouter);
// Monté AVANT publicationRouter : celui-ci expose des routes en
// `/:publicationId`, qui captureraient « generate-hashtags » comme un
// identifiant et répondraient 400 avant que cette route ne soit consultée.
app.use('/api/v1/publications', hashtagRouter);
app.use('/api/v1/publications', publicationRouter);
app.use('/api/v1/publications', publicationApprovalRouter);
app.use('/api/v1/approvals', approvalsRouter);
app.use('/api/v1/calendar', calendarRouter);
app.use('/api/v1/social-accounts', socialAccountRouter);
app.use('/api/v1/comments', commentRouter);
app.use('/api/v1/competitors', competitorRouter);
app.use('/api/v1/response-suggestions', responseSuggestionRouter);
app.use('/api/v1/knowledge', knowledgeRouter);
app.use('/api/v1/ai', aiRouter);
app.use('/api/v1/ai/responses', responseSuggestionRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/device-tokens', deviceTokenRouter);
app.use('/api/v1/notification-settings', notificationSettingsRouter);
app.use('/api/v1/analytics', analyticsRouter);
app.use('/api/v1/dashboard', dashboardRouter);
// Sprint 11 Jour 3 : seul point d'entrée /internal/v1 exposé par Express —
// jusqu'ici l'API n'était qu'appelante de graph-api/ai-service, jamais
// appelée (voir lib/serviceAuth.js).
app.use('/internal/v1/notifications', internalNotificationRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export function start() {
  const server = app.listen(port, () => {
    console.log(`Hootly API listening on port ${port}`);
  });

  // Le bucket privé est créé au démarrage : la première publication avec média
  // ne doit pas échouer sur une infrastructure neuve.
  if (isStorageConfigured()) {
    ensureBucket().catch((error) => console.error({ scope: 'storage', error: error?.message }));
  }

  function shutdown(signal) {
    // La file pg-boss est fermée proprement pour ne pas laisser de job actif.
    void stopBoss();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
    console.log(`Received ${signal}; shutting down.`);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  start();
}
