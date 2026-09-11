import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { idempotencyKeyFrom, withIdempotency } from '../lib/idempotency.js';
import { loadPublication, requireBrandFromBody } from './middleware.js';
import {
  calendarSchema,
  countPublicationSchema,
  createPublicationSchema,
  listPublicationSchema,
  retryPublicationSchema,
  schedulePublicationSchema,
  updatePublicationSchema,
} from './schemas.js';
import {
  calendar,
  cancelSchedule,
  countPublications,
  createPublication,
  deletePublication,
  getPublication,
  listPublications,
  publishNow,
  retryPublication,
  schedulePublication,
  updatePublication,
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

router.use(requireAuthentication);

router.get('/', async (request, response) => {
  sendSuccess(response, await listPublications(request.auth.user.id, parse(listPublicationSchema, request.query)));
});

router.get('/counts', async (request, response) => {
  sendSuccess(response, await countPublications(request.auth.user.id, parse(countPublicationSchema, request.query)));
});

router.post('/', async (request, response) => {
  const payload = parse(createPublicationSchema, request.body);
  await requireBrandFromBody(request, payload.brandId, 'COMMUNITY_MANAGER');
  sendSuccess(response, await createPublication(request.auth.user, payload, request), 201);
});

router.get('/:publicationId', loadPublication('VIEWER'), async (request, response) => {
  sendSuccess(response, await getPublication(request.publication.id));
});

router.patch('/:publicationId', loadPublication('COMMUNITY_MANAGER'), async (request, response) => {
  const payload = parse(updatePublicationSchema, request.body);
  sendSuccess(response, await updatePublication(request.auth.user, request.publication, payload, request));
});

router.delete('/:publicationId', loadPublication('COMMUNITY_MANAGER'), async (request, response) => {
  await deletePublication(request.auth.user, request.publication, request);
  response.status(204).end();
});

router.post('/:publicationId/schedule', loadPublication('COMMUNITY_MANAGER'), async (request, response) => {
  const payload = parse(schedulePublicationSchema, request.body);
  sendSuccess(response, await schedulePublication(request.auth.user, request.publication, payload, request), 201);
});

router.patch('/:publicationId/schedule', loadPublication('COMMUNITY_MANAGER'), async (request, response) => {
  const payload = parse(schedulePublicationSchema, request.body);
  sendSuccess(response, await schedulePublication(request.auth.user, request.publication, payload, request));
});

router.delete('/:publicationId/schedule', loadPublication('COMMUNITY_MANAGER'), async (request, response) => {
  sendSuccess(response, await cancelSchedule(request.auth.user, request.publication, request));
});

/**
 * L'envoi est asynchrone : la réponse est un `202` accompagné du `jobId`. Le
 * worker exécute la livraison, ce qui garantit qu'elle survit au redémarrage
 * de l'API comme du téléphone.
 */
router.post('/:publicationId/publish', loadPublication('COMMUNITY_MANAGER'), async (request, response) => {
  const result = await withIdempotency(
    {
      key: idempotencyKeyFrom(request),
      endpoint: 'POST /api/v1/publications/:publicationId/publish',
      userId: request.auth.user.id,
      payload: { publicationId: request.publication.id },
    },
    async () => {
      const { jobId, publication } = await publishNow(request.auth.user, request.publication, request);
      return { status: 202, body: { jobId, publication }, resourceId: publication.id };
    }
  );

  if (result.replayed) response.setHeader('idempotency-replayed', 'true');
  sendSuccess(response, result.body, result.status);
});

router.post('/:publicationId/retry', loadPublication('COMMUNITY_MANAGER'), async (request, response) => {
  const payload = parse(retryPublicationSchema, request.body ?? {});
  const result = await withIdempotency(
    {
      key: idempotencyKeyFrom(request),
      endpoint: 'POST /api/v1/publications/:publicationId/retry',
      userId: request.auth.user.id,
      payload: { publicationId: request.publication.id, provider: payload.provider ?? null },
    },
    async () => {
      const { jobId, publication } = await retryPublication(request.auth.user, request.publication, payload, request);
      return { status: 202, body: { jobId, publication }, resourceId: publication.id };
    }
  );

  if (result.replayed) response.setHeader('idempotency-replayed', 'true');
  sendSuccess(response, result.body, result.status);
});

export { router as publicationRouter };

/** Routeur dédié à `/api/v1/calendar`, qui lit les mêmes publications. */
const calendarRouter = express.Router();
calendarRouter.use(requireAuthentication);
calendarRouter.get('/', async (request, response) => {
  sendSuccess(response, await calendar(request.auth.user.id, parse(calendarSchema, request.query)));
});

export { calendarRouter };
