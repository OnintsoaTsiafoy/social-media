import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { requireBrandAccess } from './middleware.js';
import {
  brandIdSchema,
  createBrandSchema,
  listBrandSchema,
  updateAiSettingsSchema,
  updateBrandSchema,
} from './schemas.js';
import {
  activateBrand,
  createBrand,
  deleteBrand,
  getAiSettings,
  getBrand,
  listBrands,
  updateAiSettings,
  updateBrand,
} from './service.js';

const router = express.Router();

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'validation_failed',
    'Les donnÃ©es envoyÃ©es ne sont pas valides.',
    result.error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.code, message: issue.message }))
  );
}

function brandIdFrom(request) {
  return request.brandId;
}

// Express's param-callback signature is (req, res, next, value) — next
// third, value fourth. This was previously swapped, which meant the try
// block below ran with the real `next` function bound to the `value`
// parameter (crashing the *next* time it was called with an actual value),
// and the actual string value bound to `next` (making `next(error)` in the
// catch block throw "next is not a function"). Confirmed live: every
// :brandId route 500'd before this fix.
router.param('brandId', (request, _response, next, value) => {
  try {
    request.brandId = parse(brandIdSchema, value);
    next();
  } catch (error) {
    next(error);
  }
});

router.use(requireAuthentication);

router.get('/', async (request, response) => {
  sendSuccess(response, await listBrands(request.auth.user.id, parse(listBrandSchema, request.query)));
});

router.post('/', async (request, response) => {
  const brand = await createBrand(request.auth.user.id, parse(createBrandSchema, request.body), request);
  sendSuccess(response, brand, 201);
});

router.post('/:brandId/activate', requireBrandAccess(), async (request, response) => {
  const brand = await activateBrand(brandIdFrom(request), request.auth.user.id, request);
  sendSuccess(response, brand);
});

router.get('/:brandId/ai-settings', requireBrandAccess(), async (request, response) => {
  sendSuccess(response, await getAiSettings(brandIdFrom(request)));
});

router.patch('/:brandId/ai-settings', requireBrandAccess('ADMIN'), async (request, response) => {
  const settings = await updateAiSettings(
    brandIdFrom(request),
    parse(updateAiSettingsSchema, request.body),
    request.auth.user.id,
    request
  );
  sendSuccess(response, settings);
});

router.get('/:brandId', requireBrandAccess(), async (request, response) => {
  sendSuccess(response, await getBrand(brandIdFrom(request), request.brandAccess));
});

router.patch('/:brandId', requireBrandAccess('ADMIN'), async (request, response) => {
  const brand = await updateBrand(
    brandIdFrom(request),
    parse(updateBrandSchema, request.body),
    request.brandAccess,
    request
  );
  sendSuccess(response, brand);
});

router.delete('/:brandId', requireBrandAccess(), async (request, response) => {
  await deleteBrand(brandIdFrom(request), request.brandAccess, request);
  response.status(204).end();
});

export { router as brandRouter };
