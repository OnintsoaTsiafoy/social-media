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
  };
  delete process.env.DATABASE_URL;
  delete process.env.SOCIAL_SERVICE_URL;
  delete process.env.AI_SERVICE_URL;

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/ready`);

      assert.equal(response.status, 503);
      assert.deepEqual((await response.json()).missing, ['DATABASE_URL', 'SOCIAL_SERVICE_URL', 'AI_SERVICE_URL']);
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
  };
  process.env.DATABASE_URL = 'postgresql://example';
  process.env.SOCIAL_SERVICE_URL = 'http://social.example';
  process.env.AI_SERVICE_URL = 'http://ai.example';

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
