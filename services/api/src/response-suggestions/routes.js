import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { loadComment } from '../comments/middleware.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { loadSuggestion } from './middleware.js';
import {
  approveSuggestionSchema,
  createSuggestionSchema,
  generateHashtagsSchema,
  listSuggestionsQuerySchema,
  rejectSuggestionSchema,
  regenerateSuggestionSchema,
  updateSuggestionSchema,
} from './schemas.js';
import {
  approveSuggestion,
  createSuggestion,
  generateHashtags,
  listSuggestions,
  rejectSuggestion,
  toPublicSuggestion,
  updateSuggestion,
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

// Le commentaire est chargé via le middleware des commentaires, qui porte déjà
// le contrôle d'accès par marque — dupliquer cette logique ici aurait créé
// deux règles d'autorisation à maintenir pour la même ressource.
function loadCommentFromBody(request, _response, next) {
  try {
    request.params.commentId = parse(createSuggestionSchema, request.body).commentId;
    next();
  } catch (error) {
    next(error);
  }
}

router.post('/', loadCommentFromBody, loadComment('COMMUNITY_MANAGER'), async (request, response) => {
  const { text, tone, language, instruction, strategy } = parse(createSuggestionSchema, request.body);
  sendSuccess(
    response,
    await createSuggestion(
      { userId: request.auth.user.id, comment: request.comment, text, tone, language, instruction, strategy },
      request
    ),
    201
  );
});

router.get(
  '/',
  (request, _response, next) => {
    try {
      request.params.commentId = parse(listSuggestionsQuerySchema, request.query).commentId;
      next();
    } catch (error) {
      next(error);
    }
  },
  loadComment('VIEWER'),
  async (request, response) => {
    sendSuccess(response, await listSuggestions(request.comment.id));
  }
);

router.get('/:suggestionId', loadSuggestion('VIEWER'), async (request, response) => {
  sendSuccess(response, toPublicSuggestion(request.suggestion));
});

router.patch('/:suggestionId', loadSuggestion(), async (request, response) => {
  const { text, tone, language } = parse(updateSuggestionSchema, request.body);
  sendSuccess(
    response,
    await updateSuggestion(
      { userId: request.auth.user.id, comment: request.comment, suggestion: request.suggestion, text, tone, language },
      request
    )
  );
});

// L'approbation est le seul chemin qui autorise ensuite un envoi
// (voir comments/service.js::replyToComment). Elle est refusée tant que le
// contrôle de sécurité signale un problème bloquant.
router.post(['/:suggestionId/approve', '/:suggestionId/accept', '/:suggestionId/edit'], loadSuggestion(), async (request, response) => {
  const payload = parse(approveSuggestionSchema, request.body ?? {});
  if (request.path.endsWith('/edit') && !payload.text) throw new HttpError(400, 'validation_failed', 'La réponse finale est requise.');
  sendSuccess(
    response,
    await approveSuggestion(
      { userId: request.auth.user.id, comment: request.comment, suggestion: request.suggestion, ...payload },
      request
    )
  );
});

router.post('/:suggestionId/reject', loadSuggestion(), async (request, response) => {
  const payload = parse(rejectSuggestionSchema, request.body ?? {});
  sendSuccess(
    response,
    await rejectSuggestion(
      { userId: request.auth.user.id, comment: request.comment, suggestion: request.suggestion, ...payload },
      request
    )
  );
});

router.post('/:suggestionId/regenerate', loadSuggestion(), async (request, response) => {
  const payload = parse(regenerateSuggestionSchema, request.body ?? {});
  sendSuccess(response, await createSuggestion({ userId: request.auth.user.id, comment: request.comment,
    expectedSuggestionId: request.suggestion.id, ...payload }, request), 201);
});

export { router as responseSuggestionRouter };

// Exporté séparément : monté sous /api/v1/publications, pas sous
// /api/v1/response-suggestions (la fiche du sprint place la génération de
// hashtags du côté des publications, là où l'écran l'utilise).
export const hashtagRouter = express.Router();

hashtagRouter.use(requireAuthentication);

hashtagRouter.post(
  '/generate-hashtags',
  (request, _response, next) => {
    try {
      request.brandId = parse(generateHashtagsSchema, request.body).brandId;
      next();
    } catch (error) {
      next(error);
    }
  },
  requireBrandAccess(),
  async (request, response) => {
    const { text, preserve } = parse(generateHashtagsSchema, request.body);
    sendSuccess(response, await generateHashtags({ brandId: request.brandId, text, preserve }));
  }
);
