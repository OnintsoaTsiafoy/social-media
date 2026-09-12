-- Sprint 08: webhook events, comment persistence, status history, sent replies.
-- Only genuinely new statements are kept below — `prisma migrate diff` also
-- proposed an unrelated `DROP DEFAULT` on every existing table's `id` column
-- (a pre-existing Prisma/DB default mismatch, already excluded the same way
-- in the Sprint 06 migration; would break raw-SQL inserts that omit `id` and
-- rely on the DB's own `gen_random_uuid()` default).

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('NEW', 'PROCESSED', 'IGNORED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "social_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "social_account_id" UUID NOT NULL,
    "external_comment_id" VARCHAR(255) NOT NULL,
    "external_publication_id" VARCHAR(255),
    "author_external_id" VARCHAR(255),
    "author_name" VARCHAR(255),
    "content" TEXT,
    "status" "CommentStatus" NOT NULL DEFAULT 'NEW',
    "is_deleted_on_platform" BOOLEAN NOT NULL DEFAULT false,
    "meta_created_at" TIMESTAMPTZ(6),
    "meta_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "social_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "comment_id" UUID NOT NULL,
    "from_status" "CommentStatus",
    "to_status" "CommentStatus" NOT NULL,
    "changed_by_user_id" UUID,
    "note" TEXT,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "SocialProvider" NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error_message" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sent_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "comment_id" UUID NOT NULL,
    "social_account_id" UUID NOT NULL,
    "external_reply_id" VARCHAR(255),
    "content" TEXT NOT NULL,
    "sent_by_user_id" UUID NOT NULL,
    "status" "DeliveryAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "error_code" VARCHAR(80),
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "sent_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_comments_social_account_id_status_idx" ON "social_comments"("social_account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "social_comments_social_account_id_external_comment_id_key" ON "social_comments"("social_account_id", "external_comment_id");

-- CreateIndex
CREATE INDEX "comment_status_history_comment_id_changed_at_idx" ON "comment_status_history"("comment_id", "changed_at");

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_payload_hash_key" ON "webhook_events"("provider", "payload_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sent_responses_comment_id_key" ON "sent_responses"("comment_id");

-- CreateIndex
CREATE INDEX "sent_responses_status_started_at_idx" ON "sent_responses"("status", "started_at");

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_status_history" ADD CONSTRAINT "comment_status_history_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "social_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_status_history" ADD CONSTRAINT "comment_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sent_responses" ADD CONSTRAINT "sent_responses_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "social_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sent_responses" ADD CONSTRAINT "sent_responses_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sent_responses" ADD CONSTRAINT "sent_responses_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
