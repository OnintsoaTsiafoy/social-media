import assert from 'node:assert/strict';
import test from 'node:test';

import { createMediaCleanup } from '../src/cleanup-media.js';
import { createFakeDb } from './fake-db.js';

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function mediaFixture() {
  return [
    { id: 'old-orphan', bucket: 'hootly', object_key: 'temporary/u1/old.jpg', status: 'TEMPORARY', created_at: hoursAgo(48) },
    { id: 'recent-orphan', bucket: 'hootly', object_key: 'temporary/u1/recent.jpg', status: 'TEMPORARY', created_at: hoursAgo(2) },
    { id: 'attached', bucket: 'hootly', object_key: 'temporary/u1/used.jpg', status: 'TEMPORARY', created_at: hoursAgo(48), attached: true },
    { id: 'published', bucket: 'hootly', object_key: 'brands/b1/publications/p1/m.jpg', status: 'READY', created_at: hoursAgo(72) },
  ];
}

test('seuls les médias temporaires anciens et non rattachés sont supprimés', async () => {
  const db = createFakeDb({ media: mediaFixture() });
  const deleted = [];
  const { cleanup } = createMediaCleanup({
    query: db.query,
    deleteObject: async (bucket, key) => deleted.push(key),
  });

  const result = await cleanup({ olderThanHours: 24 });

  assert.deepEqual(result, { inspected: 1, deleted: 1 });
  assert.deepEqual(deleted, ['temporary/u1/old.jpg']);
  assert.equal(db.state.media.find((row) => row.id === 'old-orphan').status, 'DELETED');
  // Un média encore utilisé par une publication n'est jamais supprimé.
  assert.equal(db.state.media.find((row) => row.id === 'attached').status, 'TEMPORARY');
  assert.equal(db.state.media.find((row) => row.id === 'published').status, 'READY');
});

test('un objet introuvable n’interrompt pas le nettoyage des suivants', async () => {
  const media = mediaFixture();
  media.push({
    id: 'second-orphan',
    bucket: 'hootly',
    object_key: 'temporary/u1/second.jpg',
    status: 'TEMPORARY',
    created_at: hoursAgo(50),
  });

  const db = createFakeDb({ media });
  const { cleanup } = createMediaCleanup({
    query: db.query,
    deleteObject: async (_bucket, key) => {
      if (key.endsWith('old.jpg')) throw new Error('NoSuchKey');
    },
    logger: { error() {} },
  });

  const result = await cleanup({ olderThanHours: 24 });

  assert.deepEqual(result, { inspected: 2, deleted: 1 });
  assert.equal(db.state.media.find((row) => row.id === 'old-orphan').status, 'TEMPORARY');
  assert.equal(db.state.media.find((row) => row.id === 'second-orphan').status, 'DELETED');
});
