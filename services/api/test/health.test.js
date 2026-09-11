import assert from 'node:assert/strict';
import test from 'node:test';

import { app } from '../src/server.js';

async function withServer(run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('health is always available', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', service: 'api' });
  });
});

test('ready reports a missing configuration', async () => {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    SOCIAL_SERVICE_URL: process.env.SOCIAL_SERVICE_URL,
    AI_SERVICE_URL: process.env.AI_SERVICE_URL,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    MEDIA_BUCKET: process.env.MEDIA_BUCKET,
  };
  for (const name of Object.keys(previous)) delete process.env[name];

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/ready`);

      assert.equal(response.status, 503);
      assert.deepEqual((await response.json()).missing, [
        'DATABASE_URL',
        'SOCIAL_SERVICE_URL',
        'AI_SERVICE_URL',
        'JWT_ACCESS_SECRET',
        // Le stockage média est une dépendance de l'API depuis le Sprint 04.
        'S3_ENDPOINT',
        'MEDIA_BUCKET',
      ]);
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('ready succeeds when all dependencies are configured', async () => {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    SOCIAL_SERVICE_URL: process.env.SOCIAL_SERVICE_URL,
    AI_SERVICE_URL: process.env.AI_SERVICE_URL,
    JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    MEDIA_BUCKET: process.env.MEDIA_BUCKET,
  };
  process.env.DATABASE_URL = 'postgresql://example';
  process.env.SOCIAL_SERVICE_URL = 'http://social.example';
  process.env.AI_SERVICE_URL = 'http://ai.example';
  process.env.JWT_ACCESS_SECRET = 'test-only-signing-secret-that-is-long-enough';
  process.env.S3_ENDPOINT = 'http://minio.example:9000';
  process.env.MEDIA_BUCKET = 'hootly-test';

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/ready`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ready', service: 'api' });
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
