import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import {
  analyticsQuerySchema,
  insightBrandSchema,
  insightFeedbackSchema,
  insightHistorySchema,
  insightIdSchema,
  insightQuerySchema,
  bestTimesQuerySchema,
  publicationAnalyticsQuerySchema,
  syncAnalyticsSchema,
  timelineQuerySchema,
  topPublicationsQuerySchema,
} from './schemas.js';
import {
  analyticsBestTimes,
  analyticsNetworksComparison,
  analyticsPriorities,
  analyticsSentiments,
  analyticsSummary,
  analyticsTimeline,
  analyticsTopPublications,
  explainBestTimes,
  publicationAnalytics,
  syncBrandMetrics,
} from './service.js';
import { analyticsInsights, generateAnalyticsInsight, insightDetail, insightFeedbackStats,
  insightHistory, saveInsightFeedback } from './insights.js';

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

router.get('/insights', withBrandQuery(insightQuerySchema), requireBrandAccess(), async (request, response) => {
  sendSuccess(response, await analyticsInsights(parse(insightQuerySchema, request.query)));
});

router.post('/insights', (request, _response, next) => {
  try {
    request.brandId = parse(insightQuerySchema, request.body).brandId;
    next();
  } catch (error) { next(error); }
}, requireBrandAccess('COMMUNITY_MANAGER'), async (request, response) => {
  sendSuccess(response, await generateAnalyticsInsight(parse(insightQuerySchema, request.body), request), 201);
});

router.get('/insights/history', withBrandQuery(insightHistorySchema), requireBrandAccess(), async (request, response) => {
  sendSuccess(response, await insightHistory(parse(insightHistorySchema, request.query), request.auth.user.id));
});

router.get('/insights/feedback/stats', withBrandQuery(insightQuerySchema), requireBrandAccess(), async (request, response) => {
  sendSuccess(response, await insightFeedbackStats(parse(insightQuerySchema, request.query)));
});

router.get('/insights/:insightId', withBrandQuery(insightBrandSchema), requireBrandAccess(), async (request, response) => {
  const { insightId } = parse(insightIdSchema, request.params);
  sendSuccess(response, await insightDetail(request.brandId, insightId, request.auth.user.id));
});

router.put('/insights/:insightId/feedback', withBrandQuery(insightBrandSchema), requireBrandAccess(), async (request, response) => {
  const { insightId } = parse(insightIdSchema, request.params);
  sendSuccess(response, await saveInsightFeedback({ brandId: request.brandId, insightId,
    userId: request.auth.user.id, ...parse(insightFeedbackSchema, request.body) }));
});

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

router.get('/best-times', withBrandQuery(bestTimesQuerySchema), requireBrandAccess(), async (request, response) => {
  const { brandId, network, period, timezone } = parse(bestTimesQuerySchema, request.query);
  sendSuccess(response, await analyticsBestTimes({ brandId, network, period, timezone }));
});

router.post(
  '/best-times/explain',
  (request, _response, next) => {
    try {
      request.brandId = parse(bestTimesQuerySchema, request.body).brandId;
      next();
    } catch (error) {
      next(error);
    }
  },
  requireBrandAccess(),
  async (request, response) => {
    const { brandId, network, period, timezone } = parse(bestTimesQuerySchema, request.body);
    sendSuccess(response, await explainBestTimes({ brandId, network, period, timezone }));
  }
);

export { router as analyticsRouter };
