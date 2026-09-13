import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyticsQuerySchema,
  syncAnalyticsSchema,
  timelineQuerySchema,
  topPublicationsQuerySchema,
} from '../src/analytics/schemas.js';

const BRAND_ID = '8d10e3e8-85b7-4fd3-8e6c-67d3188eecab';

test('sync requires a brandId', () => {
  assert.throws(() => syncAnalyticsSchema.parse({}));
  assert.equal(syncAnalyticsSchema.parse({ brandId: BRAND_ID }).brandId, BRAND_ID);
});

test('analytics query defaults period to 30d and network to all', () => {
  const parsed = analyticsQuerySchema.parse({ brandId: BRAND_ID });
  assert.equal(parsed.period, '30d');
  assert.equal(parsed.network, 'all');
});

test('analytics query rejects an unknown period or network', () => {
  assert.throws(() => analyticsQuerySchema.parse({ brandId: BRAND_ID, period: '13d' }));
  assert.throws(() => analyticsQuerySchema.parse({ brandId: BRAND_ID, network: 'twitter' }));
  assert.throws(() => analyticsQuerySchema.parse({}));
});

test('timeline query never accepts a period parameter', () => {
  const parsed = timelineQuerySchema.parse({ brandId: BRAND_ID, network: 'facebook' });
  assert.deepEqual(Object.keys(parsed).sort(), ['brandId', 'network']);
});

test('top publications query defaults limit to 5 and caps it at 20', () => {
  assert.equal(topPublicationsQuerySchema.parse({ brandId: BRAND_ID }).limit, 5);
  assert.throws(() => topPublicationsQuerySchema.parse({ brandId: BRAND_ID, limit: 21 }));
  assert.throws(() => topPublicationsQuerySchema.parse({ brandId: BRAND_ID, limit: 0 }));
});
