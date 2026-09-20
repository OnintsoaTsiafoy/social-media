import express from 'express';

import { requireAuthentication } from '../auth/middleware.js';
import { toPublicUser } from '../auth/service.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { adminTrend, adminPagesPerformance } from './analytics.js';
import { listAuditTrail } from './audit.js';
import { requirePlatformAdmin } from './middleware.js';
import { adminLive, adminOverview, adminSummary } from './overview.js';
import { getPageSelection, linkPageSelection, startPageConnection } from './pageConnection.js';
import { listPages, updatePage } from './pages.js';
import {
  addKeywordSchema,
  approveDraftSchema,
  auditQuerySchema,
  connectPageSchema,
  escalateSchema,
  idSchema,
  keywordSchema,
  listPagesQuerySchema,
  listUsersQuerySchema,
  linkSelectionSchema,
  liveQuerySchema,
  overviewQuerySchema,
  pagesPerformanceQuerySchema,
  rejectDraftSchema,
  serviceLevelsPatchSchema,
  supervisionPatchSchema,
  trendQuerySchema,
  updatePageSchema,
  updateUserSchema,
} from './schemas.js';
import {
  addKeyword,
  getSettings,
  removeKeyword,
  updateServiceLevels,
  updateSupervision,
} from './settings.js';
import { approveAndSend, escalateDraft, rejectDraft, resolveEscalation, supervisionSnapshot } from './supervision.js';
import { listUsers, updateUser } from './users.js';

const router = express.Router();

function parse(schema, input, message = 'Les données envoyées ne sont pas valides.') {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'validation_failed',
    message,
    result.error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.code, message: issue.message }))
  );
}

const parseId = (value) => parse(idSchema, value, 'Identifiant invalide.');
// Réglages : qui a fait quoi, pour l'audit et le verrou de ligne.
const contextOf = (request) => ({ userId: request.auth.user.id, requestId: request.requestId });

router.use(requireAuthentication, requirePlatformAdmin);

// Ouverture de la console : confirme le rôle et donne le profil affiché en bas de la barre latérale.
router.get('/session', (request, response) => {
  sendSuccess(response, { user: toPublicUser(request.auth.user), platformRole: 'platform_admin' });
});

router.get('/summary', async (_request, response) => {
  sendSuccess(response, await adminSummary());
});

router.get('/overview', async (request, response) => {
  const { period, network } = parse(overviewQuerySchema, request.query);
  sendSuccess(response, await adminOverview({ period, network, timezone: request.auth.user.timezone }));
});

router.get('/live', async (request, response) => {
  sendSuccess(response, await adminLive(parse(liveQuerySchema, request.query)));
});

// --- Supervision IA ------------------------------------------------------------

router.get('/supervision', async (_request, response) => {
  sendSuccess(response, await supervisionSnapshot());
});

router.post('/supervision/drafts/:suggestionId/approve', async (request, response) => {
  const id = parseId(request.params.suggestionId);
  const body = parse(approveDraftSchema, request.body ?? {});
  sendSuccess(response, await approveAndSend(id, body, request.auth.user, request));
});

router.post('/supervision/drafts/:suggestionId/reject', async (request, response) => {
  const id = parseId(request.params.suggestionId);
  sendSuccess(response, await rejectDraft(id, parse(rejectDraftSchema, request.body), request.auth.user, request));
});

router.post('/supervision/drafts/:suggestionId/escalate', async (request, response) => {
  const id = parseId(request.params.suggestionId);
  sendSuccess(response, await escalateDraft(id, parse(escalateSchema, request.body ?? {}), request.auth.user, request));
});

router.post('/escalations/:commentId/resolve', async (request, response) => {
  const id = parseId(request.params.commentId);
  sendSuccess(response, await resolveEscalation(id, parse(escalateSchema, request.body ?? {}), request.auth.user, request));
});

// --- Analytique ------------------------------------------------------------------

router.get('/analytics/trend', async (request, response) => {
  sendSuccess(response, await adminTrend(parse(trendQuerySchema, request.query)));
});

router.get('/analytics/pages', async (request, response) => {
  const query = parse(pagesPerformanceQuerySchema, request.query);
  sendSuccess(response, await adminPagesPerformance({ ...query, timezone: request.auth.user.timezone }));
});

// --- Utilisateurs et rôles ---------------------------------------------------------

router.get('/users', async (request, response) => {
  sendSuccess(response, await listUsers(parse(listUsersQuerySchema, request.query)));
});

router.patch('/users/:userId', async (request, response) => {
  const id = parseId(request.params.userId);
  sendSuccess(response, await updateUser(id, parse(updateUserSchema, request.body), request.auth.user, request));
});

// --- Pages connectées ----------------------------------------------------------------

router.get('/pages', async (request, response) => {
  sendSuccess(response, await listPages(parse(listPagesQuerySchema, request.query)));
});

// Liaison d'un compte utilisateur à une page Facebook, pilotée par l'administrateur :
// démarrer (adresse Meta), lire les pages proposées au retour, lier celles qu'il choisit.
router.post('/pages/connect', async (request, response) => {
  const body = parse(connectPageSchema, request.body);
  sendSuccess(response, await startPageConnection(body, request.auth.user, request), 201);
});

router.get('/pages/connect/selections/:selectionId', async (request, response) => {
  const id = parseId(request.params.selectionId);
  sendSuccess(response, await getPageSelection(id, request.auth.user));
});

router.post('/pages/connect/selections/:selectionId/link', async (request, response) => {
  const id = parseId(request.params.selectionId);
  const body = parse(linkSelectionSchema, request.body);
  sendSuccess(response, await linkPageSelection(id, body, request.auth.user, request));
});

router.patch('/pages/:pageId', async (request, response) => {
  const id = parseId(request.params.pageId);
  sendSuccess(response, await updatePage(id, parse(updatePageSchema, request.body), contextOf(request)));
});

// --- Configuration --------------------------------------------------------------------

router.get('/settings', async (_request, response) => {
  sendSuccess(response, await getSettings());
});

router.post('/settings/keywords', async (request, response) => {
  const { word } = parse(addKeywordSchema, request.body);
  sendSuccess(response, await addKeyword(word, contextOf(request)), 201);
});

router.delete('/settings/keywords/:word', async (request, response) => {
  const word = parse(keywordSchema, request.params.word, 'Mot-clé invalide.');
  sendSuccess(response, await removeKeyword(word, contextOf(request)));
});

router.patch('/settings/service-levels', async (request, response) => {
  sendSuccess(response, await updateServiceLevels(parse(serviceLevelsPatchSchema, request.body), contextOf(request)));
});

router.patch('/settings/supervision', async (request, response) => {
  sendSuccess(response, await updateSupervision(parse(supervisionPatchSchema, request.body), contextOf(request)));
});

router.get('/audit', async (request, response) => {
  sendSuccess(response, await listAuditTrail(parse(auditQuerySchema, request.query)));
});

export { router as adminRouter };
