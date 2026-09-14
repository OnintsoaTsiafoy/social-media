import express from 'express';
import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { sendSuccess } from '../lib/http.js';
import { knowledgeQuerySchema, parse, retrieveSchema } from '../knowledge/schemas.js';
import { retrieve } from '../knowledge/service.js';
import { evaluationDataset, feedbackStats } from './service.js';

export const aiRouter = express.Router();
aiRouter.use(requireAuthentication);
function input(schema, source) {
  return (req, _res, next) => {
    try { req.input = parse(schema, req[source]); req.brandId = req.input.brandId; next(); } catch (e) { next(e); }
  };
}
aiRouter.post('/retrieve', input(retrieveSchema, 'body'), requireBrandAccess('COMMUNITY_MANAGER'), async (req, res) => {
  sendSuccess(res, await retrieve({ ...req.input, userId: req.auth.user.id }));
});
aiRouter.get('/feedback/stats', input(knowledgeQuerySchema, 'query'), requireBrandAccess(), async (req, res) => {
  sendSuccess(res, await feedbackStats(req.brandId));
});
aiRouter.get('/feedback/dataset', input(knowledgeQuerySchema, 'query'), requireBrandAccess('COMMUNITY_MANAGER'), async (req, res) => {
  sendSuccess(res, await evaluationDataset(req.brandId, req.input));
});
