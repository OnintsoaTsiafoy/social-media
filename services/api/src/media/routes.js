import express from 'express';
import multer from 'multer';

import { requireAuthentication } from '../auth/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { MEDIA_LIMITS, mediaIdSchema, uploadMediaSchema } from './schemas.js';
import { deleteMedia, getMedia, uploadMedia } from './service.js';

const router = express.Router();

// Le fichier reste en mémoire : il est inspecté puis poussé vers MinIO sans
// jamais toucher le disque de l'API.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MEDIA_LIMITS.maxBytes, files: 1 } });

/** Traduit les erreurs multer en erreurs métier stables. */
function receiveFile(request, response, next) {
  upload.single('file')(request, response, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(new HttpError(413, 'media_too_large', 'Fichier trop lourd. Maximum ' + MEDIA_LIMITS.maxBytes + ' octets.'));
    }
    return next(new HttpError(400, 'validation_failed', 'Fichier illisible. Envoyez un formulaire multipart valide.'));
  });
}

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

router.post('/', receiveFile, async (request, response) => {
  const payload = parse(uploadMediaSchema, request.body ?? {});
  sendSuccess(response, await uploadMedia(request.auth.user, { ...payload, file: request.file }, request), 201);
});

router.get('/:mediaId', async (request, response) => {
  sendSuccess(response, await getMedia(request.auth.user.id, parse(mediaIdSchema, request.params.mediaId)));
});

router.delete('/:mediaId', async (request, response) => {
  await deleteMedia(request.auth.user.id, parse(mediaIdSchema, request.params.mediaId), request);
  response.status(204).end();
});

export { router as mediaRouter };
