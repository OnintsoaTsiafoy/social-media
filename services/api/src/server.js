import express from 'express';
import { fileURLToPath } from 'node:url';

import { authRouter } from './auth/routes.js';
import { addRequestContext, errorHandler, notFoundHandler } from './lib/http.js';

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
  },
};

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(addRequestContext);

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'api' });
});

app.get('/ready', (_request, response) => {
  const required = ['DATABASE_URL', 'SOCIAL_SERVICE_URL', 'AI_SERVICE_URL', 'JWT_ACCESS_SECRET'];
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
app.use(notFoundHandler);
app.use(errorHandler);

export function start() {
  const server = app.listen(port, () => {
    console.log(`Hootly API listening on port ${port}`);
  });

  function shutdown(signal) {
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
