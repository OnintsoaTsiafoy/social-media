import express from 'express';
import { fileURLToPath } from 'node:url';

import { authRouter } from './auth/routes.js';
import { brandRouter } from './brands/routes.js';
import { commentRouter } from './comments/routes.js';
import { mediaRouter } from './media/routes.js';
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
app.use('/api/v1/calendar', calendarRouter);
app.use('/api/v1/social-accounts', socialAccountRouter);
app.use('/api/v1/comments', commentRouter);
app.use('/api/v1/response-suggestions', responseSuggestionRouter);
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
