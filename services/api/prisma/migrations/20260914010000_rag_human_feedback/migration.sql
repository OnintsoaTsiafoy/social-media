CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "KnowledgeDocumentType" AS ENUM ('FAQ','PRODUCT','SERVICE','POLICY','SAV','GUIDELINE','BRAND_TONE','OTHER');
CREATE TYPE "KnowledgeStatus" AS ENUM ('PENDING','INDEXING','READY','FAILED');
CREATE TYPE "AiFeedbackType" AS ENUM ('ACCEPTED','EDITED','REJECTED','REGENERATED');

ALTER TABLE response_suggestions
  ADD COLUMN generated_text TEXT,
  ADD COLUMN final_text TEXT,
  ADD COLUMN generation_id UUID,
  ADD COLUMN confidence_score DOUBLE PRECISION,
  ADD COLUMN sources JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN similar_examples JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN analysis_snapshot JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN strategy VARCHAR(32) NOT NULL DEFAULT 'llm',
  ADD COLUMN duration_ms INTEGER;
CREATE INDEX response_suggestions_generation_id_idx ON response_suggestions(generation_id);
UPDATE response_suggestions SET generated_text = text WHERE generated_by_ai = true;
UPDATE response_suggestions SET final_text = text WHERE approved_at IS NOT NULL;

CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE ON UPDATE CASCADE,
  title VARCHAR(200) NOT NULL,
  document_type "KnowledgeDocumentType" NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  original_filename VARCHAR(255),
  content TEXT NOT NULL,
  internal BOOLEAN NOT NULL DEFAULT false,
  status "KnowledgeStatus" NOT NULL DEFAULT 'PENDING',
  revision INTEGER NOT NULL DEFAULT 1,
  embedding_model VARCHAR(120),
  error TEXT,
  indexed_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX knowledge_documents_user_id_brand_id_created_at_idx ON knowledge_documents(user_id, brand_id, created_at);

CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE ON UPDATE CASCADE,
  content TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  chunk_index INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX knowledge_chunks_document_id_chunk_index_key ON knowledge_chunks(document_id, chunk_index);
CREATE INDEX knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE ai_feedback (
  id UUID PRIMARY KEY,
  response_id UUID NOT NULL REFERENCES response_suggestions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  final_suggestion_id UUID,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  feedback_type "AiFeedbackType" NOT NULL,
  reason VARCHAR(500),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment VARCHAR(1000),
  final_response TEXT,
  edit_distance INTEGER,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX ai_feedback_response_id_key ON ai_feedback(response_id);

CREATE TABLE validated_response_examples (
  id UUID PRIMARY KEY,
  brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE ON UPDATE CASCADE,
  response_id UUID NOT NULL REFERENCES response_suggestions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  comment_text TEXT NOT NULL,
  final_response TEXT NOT NULL,
  analysis JSONB NOT NULL DEFAULT '{}',
  embedding vector(384),
  embedding_model VARCHAR(120),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX validated_response_examples_response_id_key ON validated_response_examples(response_id);
CREATE INDEX validated_response_examples_brand_id_created_at_idx ON validated_response_examples(brand_id, created_at);
CREATE INDEX validated_response_examples_embedding_idx ON validated_response_examples USING hnsw (embedding vector_cosine_ops);
