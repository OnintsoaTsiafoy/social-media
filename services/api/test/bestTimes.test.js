import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeBestTimes,
  MIN_PUBLICATIONS_PER_SLOT,
  resolveWeekdayHour,
  slotForHour,
} from '../src/analytics/bestTimes.js';

test('resolveWeekdayHour reads the wall clock of the given timezone, not the server’s', () => {
  // 2026-01-13T20:30:00Z is a Tuesday in UTC, in January so no zone below is
  // mid-DST-transition (EU/US both start DST in March).
  const instant = new Date('2026-01-13T20:30:00.000Z');

  // Europe/Paris (CET, UTC+1) : 21:30, still Tuesday.
  assert.deepEqual(resolveWeekdayHour(instant, 'Europe/Paris'), { weekday: 1, hour: 21 });

  // Pacific/Noumea (UTC+11, no DST) : 07:30 the next day, Wednesday.
  assert.deepEqual(resolveWeekdayHour(instant, 'Pacific/Noumea'), { weekday: 2, hour: 7 });

  // America/New_York (EST, UTC-5) : 15:30, still Tuesday.
  assert.deepEqual(resolveWeekdayHour(instant, 'America/New_York'), { weekday: 1, hour: 15 });
});

test('resolveWeekdayHour handles the midnight ICU quirk (hour12:false can render "24")', () => {
  const midnightInParis = new Date('2026-06-01T22:00:00.000Z'); // 00:00 Paris (CEST, UTC+2), Tuesday 2 June
  assert.deepEqual(resolveWeekdayHour(midnightInParis, 'Europe/Paris'), { weekday: 1, hour: 0 });
});

test('slotForHour covers 06h-00h and excludes 00h-06h', () => {
  assert.equal(slotForHour(6).id, '06-09');
  assert.equal(slotForHour(8).id, '06-09');
  assert.equal(slotForHour(18).id, '18-21');
  assert.equal(slotForHour(23).id, '21-00');
  assert.equal(slotForHour(0), null);
  assert.equal(slotForHour(5), null);
});

function row({ weekday, hour, engagementRate, reach = 1000, interactions = 100 }) {
  return { weekday, hour, engagementRate, reach, interactions };
}

test('computeBestTimes reports insufficient_data when no bucket reaches the minimum', () => {
  const rows = Array.from({ length: MIN_PUBLICATIONS_PER_SLOT - 1 }, () =>
    row({ weekday: 1, hour: 19, engagementRate: 0.1 })
  );

  const result = computeBestTimes(rows);

  assert.equal(result.status, 'insufficient_data');
  assert.equal(result.best, null);
  assert.deepEqual(result.alternatives, []);
  assert.equal(result.minimumRequired, MIN_PUBLICATIONS_PER_SLOT);
});

test('computeBestTimes excludes rows outside the defined slots and rows without usable metrics', () => {
  const rows = [
    ...Array.from({ length: MIN_PUBLICATIONS_PER_SLOT }, () => row({ weekday: 1, hour: 19, engagementRate: 0.2 })),
    row({ weekday: 1, hour: 2, engagementRate: 0.5 }), // 02h : outside every slot
    row({ weekday: 1, hour: 19, engagementRate: null, reach: null, interactions: null }), // never synced
  ];

  const result = computeBestTimes(rows);

  assert.equal(result.status, 'ok');
  assert.equal(result.analyzedCount, MIN_PUBLICATIONS_PER_SLOT);
  assert.equal(result.excludedOutsideSlots, 1);
  assert.equal(result.excludedInsufficientData, 1);
});

test('computeBestTimes ranks the higher-engagement slot first and caps alternatives at 2', () => {
  const strong = Array.from({ length: 5 }, () => row({ weekday: 1, hour: 19, engagementRate: 0.3, reach: 2000, interactions: 300 }));
  const medium = Array.from({ length: 5 }, () => row({ weekday: 2, hour: 8, engagementRate: 0.15, reach: 1000, interactions: 100 }));
  const weak = Array.from({ length: 5 }, () => row({ weekday: 3, hour: 13, engagementRate: 0.05, reach: 500, interactions: 30 }));
  const fourth = Array.from({ length: 5 }, () => row({ weekday: 4, hour: 16, engagementRate: 0.02, reach: 300, interactions: 10 }));

  const result = computeBestTimes([...strong, ...medium, ...weak, ...fourth]);

  assert.equal(result.status, 'ok');
  assert.equal(result.best.weekday, 1);
  assert.equal(result.best.slotId, '18-21');
  assert.equal(result.best.weekdayLabel, 'Mardi');
  assert.equal(result.alternatives.length, 2);
  assert.equal(result.alternatives[0].weekday, 2);
  assert.equal(result.alternatives[1].weekday, 3);
  // Scores strictly decreasing.
  const scores = [result.best, ...result.alternatives].map((slot) => slot.score);
  assert.ok(scores[0] > scores[1] && scores[1] > scores[2]);
});

test('computeBestTimes confidence follows the sample-size thresholds', () => {
  const highBucket = Array.from({ length: 10 }, () => row({ weekday: 1, hour: 19, engagementRate: 0.3 }));
  const mediumBucket = Array.from({ length: 5 }, () => row({ weekday: 2, hour: 8, engagementRate: 0.2 }));
  const lowBucket = Array.from({ length: 3 }, () => row({ weekday: 3, hour: 13, engagementRate: 0.1 }));

  const result = computeBestTimes([...highBucket, ...mediumBucket, ...lowBucket]);
  const byWeekday = Object.fromEntries(
    [result.best, ...result.alternatives].map((slot) => [slot.weekday, slot])
  );

  assert.equal(byWeekday[1].confidence, 'high');
  assert.equal(byWeekday[2].confidence, 'medium');
  assert.equal(byWeekday[3].confidence, 'low');
});

test('computeBestTimes deltaVsAveragePercent compares a slot to the average of analysed slots', () => {
  const above = Array.from({ length: 3 }, () => row({ weekday: 1, hour: 19, engagementRate: 0.3 }));
  const below = Array.from({ length: 3 }, () => row({ weekday: 2, hour: 8, engagementRate: 0.1 }));

  const result = computeBestTimes([...above, ...below]);

  assert.ok(result.best.deltaVsAveragePercent > 0);
  assert.ok(result.alternatives[0].deltaVsAveragePercent < 0);
});
