-- Sprint 10: versioned response suggestions with mandatory human approval.
-- Append-only per comment (generate/edit/regenerate add a version; approve and
-- reject update the latest), so the original AI proposal is never lost after a
-- human rewrite.
-- Same exclusion as the Sprint 06/08/09 migrations: `prisma migrate diff` also
-- proposes an unrelated `DROP DEFAULT` on every existing table's `id` column,
-- which would break raw-SQL inserts relying on gen_random_uuid().

-- CreateEnum
CREATE TYPE "ResponseSuggestionStatus" AS ENUM ('PROPOSED', 'EDITED', 'APPROVED', 'REJECTED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "response_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "comment_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "original_text" TEXT NOT NULL,
    "language" VARCHAR(8) NOT NULL DEFAULT 'fr',
    "tone" "AiTone" NOT NULL DEFAULT 'PROFESSIONAL',
    "status" "ResponseSuggestionStatus" NOT NULL DEFAULT 'PROPOSED',
    "generated_by_ai" BOOLEAN NOT NULL DEFAULT true,
    "generator" VARCHAR(64) NOT NULL,
    "prompt_version" VARCHAR(64) NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "instruction" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "response_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "response_suggestions_comment_id_version_key" ON "response_suggestions"("comment_id", "version");

-- CreateIndex
CREATE INDEX "response_suggestions_comment_id_created_at_idx" ON "response_suggestions"("comment_id", "created_at");

-- CreateIndex
CREATE INDEX "response_suggestions_status_idx" ON "response_suggestions"("status");

-- AddForeignKey
ALTER TABLE "response_suggestions" ADD CONSTRAINT "response_suggestions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "social_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_suggestions" ADD CONSTRAINT "response_suggestions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_suggestions" ADD CONSTRAINT "response_suggestions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
