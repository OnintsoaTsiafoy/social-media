import express from 'express';
import { fileURLToPath } from 'node:url';

export const app = express();
const port = Number(process.env.PORT ?? 3000);

const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Hootly Public API',
    version: '0.1.0',
    description: 'Socle Sprint 01. Les endpoints métier arrivent à partir du Sprint 02.',
  },
  paths: {
    '/health': { get: { summary: 'Liveness probe', responses: { 200: { description: 'Process alive' } } } },
    '/ready': { get: { summary: 'Readiness probe', responses: { 200: { description: 'Dependencies configured' }, 503: { description: 'Configuration missing' } } } },
  },
};

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'api' });
});

app.get('/ready', (_request, response) => {
  const required = ['DATABASE_URL', 'SOCIAL_SERVICE_URL', 'AI_SERVICE_URL'];
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

app.use((_request, response) => {
  response.status(404).json({
    error: {
      code: 'not_found',
      message: 'Route inconnue.',
    },
  });
});

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
