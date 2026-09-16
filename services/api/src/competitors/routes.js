import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { competitorAnalytics, competitorsComparison, explainComparison } from './analytics.js';
import {
  comparisonQuerySchema,
  competitorAnalyticsQuerySchema,
  competitorBrandSchema,
  competitorIdSchema,
  competitorPostsQuerySchema,
  createCompetitorSchema,
  explainComparisonSchema,
  listCompetitorsSchema,
  updateCompetitorSchema,
  verifyCompetitorSchema,
} from './schemas.js';
import {
  createCompetitor,
  deleteCompetitor,
  getCompetitor,
  listCompetitorPosts,
  listCompetitors,
  requestCompetitorSync,
  updateCompetitor,
  verifyCompetitor,
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

// Comme analytics/routes.js : la marque est portée par la requête (query ou
// corps) et non par l'URL — un concurrent est toujours lu dans le contexte
// d'une marque, et `requireBrandAccess` a besoin de `request.brandId` avant
// que le gestionnaire ne s'exécute.
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

function withBrandBody(schema) {
  return (request, _response, next) => {
    try {
      request.brandId = parse(schema, request.body).brandId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

router.use(requireAuthentication);

// Monté AVANT `/:competitorId` : sans cela, « comparison » serait capturé
// comme un identifiant et répondrait 400 avant d'atteindre cette route — même
// précaution que hashtagRouter face à publicationRouter dans server.js.
router.get(
  '/comparison',
  withBrandQuery(comparisonQuerySchema),
  requireBrandAccess(),
  async (request, response) => {
    const { brandId, period, platform, limit } = parse(comparisonQuerySchema, request.query);
    sendSuccess(response, await competitorsComparison({ brandId, period, platform, limit }));
  }
);

router.post(
  '/comparison/explain',
  withBrandBody(explainComparisonSchema),
  requireBrandAccess(),
  async (request, response) => {
    const { brandId, period, platform, limit } = parse(explainComparisonSchema, request.body);
    sendSuccess(response, await explainComparison({ brandId, period, platform, limit }, request));
  }
);

// Vérification sans enregistrement : le bouton « Vérifier » de l'écran
// d'ajout. POST malgré l'absence d'écriture — la requête déclenche un appel
// Meta et porte un corps, ce qu'un GET ne doit pas faire.
router.post(
  '/verify',
  withBrandBody(verifyCompetitorSchema),
  requireBrandAccess('COMMUNITY_MANAGER'),
  async (request, response) => {
    const { brandId, platform, handle } = parse(verifyCompetitorSchema, request.body);
    sendSuccess(response, await verifyCompetitor({ brandId, platform, handle }));
  }
);

router.get('/', withBrandQuery(listCompetitorsSchema), requireBrandAccess(), async (request, response) => {
  sendSuccess(response, await listCompetitors(parse(listCompetitorsSchema, request.query)));
});

router.post(
  '/',
  withBrandBody(createCompetitorSchema),
  requireBrandAccess('COMMUNITY_MANAGER'),
  async (request, response) => {
    const { brandId, platform, handle } = parse(createCompetitorSchema, request.body);
    sendSuccess(
      response,
      await createCompetitor({ brandId, platform, handle, userId: request.auth.user.id }, request),
      201
    );
  }
);

router.get('/:competitorId', withBrandQuery(competitorBrandSchema), requireBrandAccess(), async (request, response) => {
  const { competitorId } = parse(competitorIdSchema, request.params);
  sendSuccess(response, await getCompetitor(request.brandId, competitorId));
});

router.patch(
  '/:competitorId',
  withBrandBody(updateCompetitorSchema),
  requireBrandAccess('COMMUNITY_MANAGER'),
  async (request, response) => {
    const { competitorId } = parse(competitorIdSchema, request.params);
    const { name, handle } = parse(updateCompetitorSchema, request.body);
    sendSuccess(
      response,
      await updateCompetitor({ brandId: request.brandId, competitorId, name, handle, userId: request.auth.user.id }, request)
    );
  }
);

router.delete(
  '/:competitorId',
  withBrandQuery(competitorBrandSchema),
  requireBrandAccess('COMMUNITY_MANAGER'),
  async (request, response) => {
    const { competitorId } = parse(competitorIdSchema, request.params);
    await deleteCompetitor({ brandId: request.brandId, competitorId, userId: request.auth.user.id }, request);
    response.status(204).end();
  }
);

// 202 : la collecte appartient au worker, jamais à la requête HTTP — même
// forme que POST /api/v1/analytics/sync.
router.post(
  '/:competitorId/sync',
  withBrandBody(competitorBrandSchema),
  requireBrandAccess('COMMUNITY_MANAGER'),
  async (request, response) => {
    const { competitorId } = parse(competitorIdSchema, request.params);
    const result = await requestCompetitorSync({
      brandId: request.brandId,
      competitorId,
      userId: request.auth.user.id,
    });
    sendSuccess(response, result, 202);
  }
);

router.get(
  '/:competitorId/posts',
  withBrandQuery(competitorPostsQuerySchema),
  requireBrandAccess(),
  async (request, response) => {
    const { competitorId } = parse(competitorIdSchema, request.params);
    const { brandId, period, page, pageSize } = parse(competitorPostsQuerySchema, request.query);
    sendSuccess(response, await listCompetitorPosts({ brandId, competitorId, period, page, pageSize }));
  }
);

router.get(
  '/:competitorId/analytics',
  withBrandQuery(competitorAnalyticsQuerySchema),
  requireBrandAccess(),
  async (request, response) => {
    const { competitorId } = parse(competitorIdSchema, request.params);
    const { brandId, period } = parse(competitorAnalyticsQuerySchema, request.query);
    sendSuccess(response, await competitorAnalytics({ brandId, competitorId, period }));
  }
);

export { router as competitorRouter };
