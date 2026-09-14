import express from 'express';
import multer from 'multer';
import { requireAuthentication } from '../auth/middleware.js';
import { requireBrandAccess } from '../brands/middleware.js';
import { callAiService } from '../lib/aiServiceClient.js';
import { HttpError, sendSuccess } from '../lib/http.js';
import { createKnowledgeSchema, updateKnowledgeSchema, uploadKnowledgeSchema, knowledgeQuerySchema, idSchema, parse } from './schemas.js';
import { createDocument, deleteDocument, indexDocument, listDocuments, ownedDocument, publicDocument, updateDocument } from './service.js';

export const knowledgeRouter = express.Router();
knowledgeRouter.use(requireAuthentication);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, fieldSize: 1024 } });
function receiveFile(req, res, next) {
  upload.single('file')(req, res, (error) => next(error ? new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
    'validation_failed', error.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd : maximum 10 Mo.' : 'Import invalide.') : undefined));
}
function payload(schema, source = 'body') {
  return (req, _res, next) => {
    try { req.input = parse(schema, req[source]); req.brandId = req.input.brandId; next(); } catch (e) { next(e); }
  };
}
async function load(req, _res, next) {
  try {
    req.document = await ownedDocument(req.auth.user.id, parse(idSchema, req.params.id));
    req.brandId = req.document.brandId;
    next();
  } catch (e) { next(e); }
}
knowledgeRouter.get('/', payload(knowledgeQuerySchema, 'query'), requireBrandAccess(), async (req, res) => {
  sendSuccess(res, await listDocuments(req.auth.user.id, req.input));
});
knowledgeRouter.post('/', payload(createKnowledgeSchema), requireBrandAccess('COMMUNITY_MANAGER'), async (req, res) => {
  sendSuccess(res, await createDocument(req.auth.user.id, req.input, req), 201);
});
knowledgeRouter.post('/upload', receiveFile, payload(uploadKnowledgeSchema), requireBrandAccess('COMMUNITY_MANAGER'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'validation_failed', 'Un fichier est requis.');
  const filename = req.file.originalname.replaceAll('\\', '/').split('/').pop();
  const result = await callAiService('/internal/v1/knowledge/extract', { scope: 'ai:knowledge',
    body: { data: req.file.buffer.toString('base64'), filename, mimeType: req.file.mimetype } });
  sendSuccess(res, await createDocument(req.auth.user.id, { ...req.input, content: result.content,
    source: 'upload', originalFilename: filename }, req), 201);
});
knowledgeRouter.get('/:id', load, requireBrandAccess(), (req, res) => sendSuccess(res, publicDocument(req.document, true)));
knowledgeRouter.put('/:id', load, requireBrandAccess('COMMUNITY_MANAGER'), async (req, res) => {
  sendSuccess(res, await updateDocument(req.document, parse(updateKnowledgeSchema, req.body), req));
});
knowledgeRouter.post('/:id/reindex', load, requireBrandAccess('COMMUNITY_MANAGER'), async (req, res) => {
  sendSuccess(res, await indexDocument(req.document, req));
});
knowledgeRouter.delete('/:id', load, requireBrandAccess('COMMUNITY_MANAGER'), async (req, res) => {
  await deleteDocument(req.document, req);
  res.status(204).end();
});
