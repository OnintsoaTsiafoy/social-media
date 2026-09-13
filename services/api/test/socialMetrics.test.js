import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateSnapshots } from '../src/lib/socialMetrics.js';

function snapshot(overrides = {}) {
  return {
    reactions: null,
    comments: null,
    shares: null,
    reach: null,
    impressions: null,
    collectedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

test('des relevés entièrement null restent null, jamais zéro', () => {
  const result = aggregateSnapshots([snapshot(), snapshot()]);
  assert.deepEqual(result, {
    reactions: null,
    comments: null,
    shares: null,
    reach: null,
    impressions: null,
    engagementRate: null,
    lastSyncedAt: new Date('2026-01-01T00:00:00Z'),
  });
});

test('un reach à zéro rend engagementRate null, pas NaN ni Infinity', () => {
  const result = aggregateSnapshots([snapshot({ reach: 0, reactions: 5, comments: 2, shares: 1 })]);
  assert.equal(result.reach, 0);
  assert.equal(result.engagementRate, null);
});

test('un reach absent (null) rend aussi engagementRate null', () => {
  const result = aggregateSnapshots([snapshot({ reach: null, reactions: 5 })]);
  assert.equal(result.engagementRate, null);
});

test('seules les composantes non-null sont sommées, comme SUM en SQL', () => {
  const result = aggregateSnapshots([
    snapshot({ reactions: 5, reach: 100 }),
    snapshot({ reactions: null, comments: 2, reach: null }),
  ]);
  assert.equal(result.reactions, 5);
  assert.equal(result.comments, 2);
  assert.equal(result.reach, 100);
  assert.equal(result.engagementRate, (5 + 2) / 100);
});

test('une cible jamais synchronisée (null dans le tableau) ne casse pas l’agrégation', () => {
  const result = aggregateSnapshots([null, snapshot({ reactions: 3, reach: 10 })]);
  assert.equal(result.reactions, 3);
  assert.equal(result.engagementRate, 0.3);
});

test('lastSyncedAt retient le relevé le plus récent, quelle que soit la ligne qui porte des valeurs', () => {
  const result = aggregateSnapshots([
    snapshot({ reactions: 5, collectedAt: new Date('2026-01-01T00:00:00Z') }),
    snapshot({ reactions: null, collectedAt: new Date('2026-02-01T00:00:00Z') }),
  ]);
  assert.deepEqual(result.lastSyncedAt, new Date('2026-02-01T00:00:00Z'));
});

test('aucun relevé du tout rend tout null, y compris lastSyncedAt', () => {
  const result = aggregateSnapshots([]);
  assert.deepEqual(result, {
    reactions: null,
    comments: null,
    shares: null,
    reach: null,
    impressions: null,
    engagementRate: null,
    lastSyncedAt: null,
  });
});
