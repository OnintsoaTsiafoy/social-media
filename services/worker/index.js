import http from 'node:http';

const port = Number(process.env.PORT ?? 3001);

const server = http.createServer((request, response) => {
  const body = (status, payload) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  };

  if (request.url === '/health') {
    body(200, { status: 'ok', service: 'worker' });
    return;
  }

  if (request.url === '/ready') {
    const ready = Boolean(process.env.DATABASE_URL?.trim());
    body(ready ? 200 : 503, ready
      ? { status: 'ready', service: 'worker' }
      : { status: 'not_ready', service: 'worker', reason: 'database_url_missing' });
    return;
  }

  if (request.url === '/openapi.json') {
    body(200, {
      openapi: '3.1.0',
      info: { title: 'Hootly Worker Operations API', version: '0.1.0' },
      paths: {
        '/health': { get: { summary: 'Liveness probe' } },
        '/ready': { get: { summary: 'Readiness probe' } },
      },
    });
    return;
  }

  body(404, { error: { code: 'not_found', message: 'Route inconnue.' } });
});

server.listen(port, () => console.log(`Hootly worker health endpoint listening on ${port}`));

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
