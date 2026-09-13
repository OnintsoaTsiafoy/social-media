-- Sprint 09: persisted NLP analyses (sentiment, intent, priority, urgency).
-- Append-only table plus a cached pointer to the latest row on social_comments,
-- so inbox filtering/counting stays a single-row join instead of a
-- "most recent per comment" subquery.
-- As in the Sprint 06 and 08 migrations, only genuinely new statements are
-- kept: `prisma migrate diff` also proposes an unrelated `DROP DEFAULT` on
-- every existing table's `id` column (a pre-existing Prisma/DB default
-- mismatch that would break raw-SQL inserts relying on gen_random_uuid()).

-- CreateEnum
CREATE TYPE "CommentSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "CommentIntent" AS ENUM ('QUESTION', 'INFO_REQUEST', 'COMPLAINT', 'CLAIM', 'OTHER');

-- CreateEnum
CREATE TYPE "CommentPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "comment_analyses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "comment_id" UUID NOT NULL,
    "sentiment" "CommentSentiment" NOT NULL,
    "intent" "CommentIntent" NOT NULL,
    "priority" "CommentPriority" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sentiment_confidence" DOUBLE PRECISION NOT NULL,
    "intent_confidence" DOUBLE PRECISION NOT NULL,
    "low_confidence" BOOLEAN NOT NULL DEFAULT false,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "language" VARCHAR(8) NOT NULL DEFAULT 'fr',
    "recommended_action" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "top_terms" JSONB NOT NULL DEFAULT '[]',
    "model_version" VARCHAR(64) NOT NULL,
    "dataset_version" VARCHAR(32) NOT NULL,
    "requested_by_user_id" UUID,
    "analysed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_analyses_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "social_comments" ADD COLUMN "latest_analysis_id" UUID;

-- CreateIndex
CREATE INDEX "comment_analyses_comment_id_analysed_at_idx" ON "comment_analyses"("comment_id", "analysed_at");

-- CreateIndex
CREATE INDEX "comment_analyses_priority_idx" ON "comment_analyses"("priority");

-- CreateIndex
CREATE INDEX "comment_analyses_sentiment_idx" ON "comment_analyses"("sentiment");

-- CreateIndex
CREATE UNIQUE INDEX "social_comments_latest_analysis_id_key" ON "social_comments"("latest_analysis_id");

-- AddForeignKey
ALTER TABLE "comment_analyses" ADD CONSTRAINT "comment_analyses_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "social_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_analyses" ADD CONSTRAINT "comment_analyses_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_latest_analysis_id_fkey" FOREIGN KEY ("latest_analysis_id") REFERENCES "comment_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
