import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import {
  analyticsQuerySchema,
  publicationAnalyticsQuerySchema,
  syncAnalyticsSchema,
  timelineQuerySchema,
  topPublicationsQuerySchema,
} from './schemas.js';
import {
  analyticsNetworksComparison,
  analyticsPriorities,
  analyticsSentiments,
  analyticsSummary,
  analyticsTimeline,
  analyticsTopPublications,
  publicationAnalytics,
  syncBrandMetrics,
} from './service.js';

const router = express.Router();

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'validation_failed',
    'Les données envoyées ne sont pas valides.',
    result.error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.code, message: issue.message }))
  );
}

// Portées par brandId en query, comme comments/routes.js's `GET /`/`GET
// /counts` — jamais par un paramètre d'URL ici, il n'y a pas de ressource
// analytics identifiée en dehors de la marque elle-même (sauf /publications/
// :id, qui a sa propre route plus bas).
function withBrandQuery(schema) {
  return (request, _response, next) => {
    try {
      request.brandId = parse(schema, request.query).brandId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

router.use(requireAuthentication);

router.post(
  '/sync',
  (request, _response, next) => {
    try {
      request.brandId = parse(syncAnalyticsSchema, request.body).brandId;
      next();
    } catch (error) {
      next(error);
    }
  },
  requireBrandAccess('COMMUNITY_MANAGER'),
  async (request, response) => {
    const result = await syncBrandMetrics({ brandId: request.brandId, requestedBy: request.auth.user.id });
    sendSuccess(response, result, 202);
  }
);

router.get('/summary', withBrandQuery(analyticsQuerySchema), requireBrandAccess(), async (request, response) => {
  const { brandId, period, network } = parse(analyticsQuerySchema, request.query);
  sendSuccess(response, await analyticsSummary({ brandId, period, network }));
});

router.get('/timeline', withBrandQuery(timelineQuerySchema), requireBrandAccess(), async (request, response) => {
  const { brandId, network } = parse(timelineQuerySchema, request.query);
  sendSuccess(response, await analyticsTimeline({ brandId, network }));
});

router.get(
  '/top-publications',
  withBrandQuery(topPublicationsQuerySchema),
  requireBrandAccess(),
  async (request, response) => {
    const { brandId, period, network, limit } = parse(topPublicationsQuerySchema, request.query);
    sendSuccess(response, await analyticsTopPublications({ brandId, period, network, limit }));
  }
);

router.get(
  '/networks-comparison',
  withBrandQuery(analyticsQuerySchema),
  requireBrandAccess(),
  async (request, response) => {
    const { brandId, period, network } = parse(analyticsQuerySchema, request.query);
    sendSuccess(response, await analyticsNetworksComparison({ brandId, period, network }));
  }
);

router.get('/sentiments', withBrandQuery(analyticsQuerySchema), requireBrandAccess(), async (request, response) => {
  const { brandId, period, network } = parse(analyticsQuerySchema, request.query);
  sendSuccess(response, await analyticsSentiments({ brandId, period, network }));
});

router.get('/priorities', withBrandQuery(analyticsQuerySchema), requireBrandAccess(), async (request, response) => {
  const { brandId, period, network } = parse(analyticsQuerySchema, request.query);
  sendSuccess(response, await analyticsPriorities({ brandId, period, network }));
});

router.get(
  '/publications/:publicationId',
  withBrandQuery(publicationAnalyticsQuerySchema),
  requireBrandAccess(),
  async (request, response) => {
    sendSuccess(response, await publicationAnalytics(request.params.publicationId, request.brandId));
  }
);

export { router as analyticsRouter };
