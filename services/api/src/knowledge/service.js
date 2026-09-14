import { randomUUID } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { callAiService } from '../lib/aiServiceClient.js';
import { HttpError } from '../lib/http.js';
import { writeAuditLog } from '../lib/audit.js';

export const EMBEDDING_MODEL = 'intfloat/multilingual-e5-small';
export const DIMENSIONS = 384;
export function vectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length !== DIMENSIONS || !vector.every(Number.isFinite) || !vector.some((v) => v !== 0)) {
    throw new HttpError(503, 'ai_unavailable', 'Le service a renvoyé un embedding invalide.');
  }
  return `[${vector.join(',')}]`;
}

export function minimumSimilarity() {
  const value = Number(process.env.RAG_MIN_SIMILARITY ?? 0.82);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.82;
}

export function publicDocument(row, detail = false) {
  return {
    id: row.id, brandId: row.brandId, title: row.title, documentType: row.documentType,
    source: row.source, originalFilename: row.originalFilename, internal: row.internal,
    status: row.status, revision: row.revision, error: row.error,
    chunkCount: row._count?.chunks ?? 0, indexedAt: row.indexedAt,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
    ...(detail ? { content: row.content } : {}),
  };
}

export async function ownedDocument(userId, id) {
  const row = await prisma.knowledgeDocument.findFirst({
    where: { id, userId, brand: { status: 'ACTIVE', deletedAt: null, members: { some: { userId } } } },
    include: { _count: { select: { chunks: true } } },
  });
  if (!row) throw new HttpError(404, 'not_found', 'Document introuvable.');
  return row;
}

export async function listDocuments(userId, { brandId, page, pageSize }) {
  const where = { userId, brandId };
  const [rows, total] = await Promise.all([
    prisma.knowledgeDocument.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { chunks: true } } } }),
    prisma.knowledgeDocument.count({ where }),
  ]);
  return { items: rows.map((row) => publicDocument(row)), total, page, pageSize };
}

async function audit(userId, action, id, request) {
  await writeAuditLog(prisma, { userId, action: `knowledge.${action}`, resourceType: 'knowledge_document',
    resourceId: id, requestId: request.requestId });
}

export async function indexDocument(document, request) {
  // Compare-and-swap revision: a slow indexing run can never overwrite an edit.
  const revision = document.revision + 1;
  const claimed = await prisma.knowledgeDocument.updateMany({
    where: { id: document.id, userId: document.userId, revision: document.revision },
    data: { status: 'INDEXING', revision, error: null },
  });
  if (!claimed.count) throw new HttpError(409, 'conflict', 'Le document a été modifié. Rechargez-le.');
  try {
    const result = await callAiService('/internal/v1/knowledge/prepare', {
      scope: 'ai:knowledge', body: { content: document.content },
    });
    if (result.model !== EMBEDDING_MODEL || !result.chunks?.length || result.chunks.length > 256) {
      throw new HttpError(503, 'ai_unavailable', 'Indexation incomplète.');
    }
    const chunks = result.chunks.map((chunk) => ({ ...chunk, vector: vectorLiteral(chunk.embedding) }));
    await prisma.$transaction(async (tx) => {
      const current = await tx.knowledgeDocument.updateMany({
        where: { id: document.id, revision }, data: { status: 'READY', indexedAt: new Date(), embeddingModel: result.model },
      });
      if (!current.count) throw new HttpError(409, 'conflict', 'Une version plus récente du document existe.');
      await tx.knowledgeChunk.deleteMany({ where: { documentId: document.id } });
      for (const [index, chunk] of chunks.entries()) {
        await tx.$executeRaw`INSERT INTO knowledge_chunks (id, document_id, content, embedding, chunk_index, metadata)
          VALUES (${randomUUID()}::uuid, ${document.id}::uuid, ${chunk.content}, ${chunk.vector}::vector, ${index}, ${JSON.stringify(chunk.metadata ?? {})}::jsonb)`;
      }
    }, { timeout: 30_000 });
    await audit(document.userId, 'indexed', document.id, request);
  } catch (error) {
    if (error.status === 409) throw error;
    await prisma.knowledgeDocument.updateMany({ where: { id: document.id, revision },
      data: { status: 'FAILED', error: error instanceof HttpError ? error.message : 'Indexation impossible. Réessayez.' } });
  }
  return publicDocument(await ownedDocument(document.userId, document.id), true);
}

export async function createDocument(userId, input, request) {
  const row = await prisma.knowledgeDocument.create({ data: { ...input, userId } });
  await audit(userId, 'created', row.id, request);
  return indexDocument(row, request);
}

export async function updateDocument(document, input, request) {
  const { revision, ...changes } = input;
  const result = await prisma.knowledgeDocument.updateMany({
    where: { id: document.id, userId: document.userId, revision },
    data: { ...changes, revision: { increment: 1 }, status: 'PENDING', error: null },
  });
  if (!result.count) throw new HttpError(409, 'conflict', 'Le document a été modifié. Rechargez-le.');
  await audit(document.userId, 'updated', document.id, request);
  return indexDocument(await ownedDocument(document.userId, document.id), request);
}

export async function deleteDocument(document, request) {
  await prisma.knowledgeDocument.delete({ where: { id: document.id } });
  await audit(document.userId, 'deleted', document.id, request);
}

export async function queryEmbedding(text, kind = 'query') {
  const result = await callAiService('/internal/v1/knowledge/embed', {
    scope: 'ai:knowledge', body: { texts: [text.slice(0, 4000)], kind },
  });
  if (result.model !== EMBEDDING_MODEL) throw new HttpError(503, 'ai_unavailable', 'Modèle d’embedding incompatible.');
  return vectorLiteral(result.embeddings?.[0]);
}

export async function retrieve({ userId, brandId, query, limit = 5, vector }) {
  const embedding = vector ?? await queryEmbedding(query);
  const threshold = minimumSimilarity();
  // Exact search over the authorized subset: HNSW post-filtering can lose
  // tenant results. MATERIALIZED preserves Top K correctness for small bases.
  const results = await prisma.$queryRaw`
    WITH allowed AS MATERIALIZED (
      SELECT c.id, c.document_id, c.content, c.embedding, c.chunk_index, d.title, d.revision
      FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
      JOIN brands b ON b.id = d.brand_id
      WHERE d.brand_id = ${brandId}::uuid AND d.user_id = ${userId}::uuid
        AND d.status = 'READY' AND d.internal = false AND d.embedding_model = ${EMBEDDING_MODEL}
        AND b.deleted_at IS NULL AND b.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM brand_members m WHERE m.brand_id = b.id AND m.user_id = ${userId}::uuid)
    )
    SELECT id AS "chunkId", document_id AS "documentId", title, content, chunk_index AS "chunkIndex", revision,
      1 - (embedding <=> ${embedding}::vector) AS score
    FROM allowed WHERE 1 - (embedding <=> ${embedding}::vector) >= ${threshold}
    ORDER BY embedding <=> ${embedding}::vector, id LIMIT ${limit}`;
  return { results, confidenceScore: Math.max(0, Math.min(1, results[0]?.score ?? 0)) };
}

export async function similarExamples({ brandId, vector, excludeCommentId }) {
  const threshold = minimumSimilarity();
  return prisma.$queryRaw`
    SELECT e.id, e.comment_text AS "commentText", e.final_response AS "finalResponse",
      1 - (e.embedding <=> ${vector}::vector) AS score
    FROM validated_response_examples e
    JOIN response_suggestions r ON r.id = e.response_id
    JOIN ai_feedback f ON f.response_id = e.response_id
    WHERE e.brand_id = ${brandId}::uuid AND e.embedding_model = ${EMBEDDING_MODEL}
      AND f.feedback_type IN ('ACCEPTED', 'EDITED') AND r.comment_id <> ${excludeCommentId}::uuid
      AND 1 - (e.embedding <=> ${vector}::vector) >= ${threshold}
    ORDER BY e.embedding <=> ${vector}::vector, e.id LIMIT 3`;
}
