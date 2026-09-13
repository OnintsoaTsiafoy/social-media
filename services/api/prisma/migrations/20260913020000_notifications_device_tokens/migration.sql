-- Sprint 11: notifications (one row per recipient), FCM device tokens and
-- per-user notification settings. Firebase is a delivery channel only — this
-- table, not FCM, is the source of truth for history and unread state.
-- Same exclusion as the Sprint 06/08/09/10 migrations: `prisma migrate diff`
-- also proposes an unrelated `DROP DEFAULT` on every existing table's `id`
-- column, which would break raw-SQL inserts relying on gen_random_uuid().

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PRIORITY_COMMENT', 'NEGATIVE_COMMENT', 'URGENT_COMMENT', 'AI_RESPONSE_READY', 'PUBLICATION_PUBLISHED', 'PUBLICATION_FAILED', 'PUBLICATION_PARTIAL', 'TOKEN_EXPIRING', 'TOKEN_EXPIRED', 'SYNC_FAILED', 'ACCOUNT_DISCONNECTED');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "NotificationResourceType" AS ENUM ('COMMENT', 'PUBLICATION', 'SOCIAL_ACCOUNT');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "brand_id" UUID,
    "type" "NotificationType" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "network" "SocialProvider",
    "resource_type" "NotificationResourceType",
    "resource_id" UUID,
    "event_id" VARCHAR(150) NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(400) NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "user_id" UUID NOT NULL,
    "negative_comment" BOOLEAN NOT NULL DEFAULT true,
    "urgent_comment" BOOLEAN NOT NULL DEFAULT true,
    "high_priority_comment" BOOLEAN NOT NULL DEFAULT true,
    "ai_response_generated" BOOLEAN NOT NULL DEFAULT true,
    "publication_published" BOOLEAN NOT NULL DEFAULT true,
    "publication_failed" BOOLEAN NOT NULL DEFAULT true,
    "token_expiring" BOOLEAN NOT NULL DEFAULT true,
    "sync_failed" BOOLEAN NOT NULL DEFAULT true,
    "sound" BOOLEAN NOT NULL DEFAULT true,
    "vibration" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_start" VARCHAR(5),
    "quiet_hours_end" VARCHAR(5),
    "minimum_priority" "NotificationPriority" NOT NULL DEFAULT 'LOW',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_event_id_user_id_key" ON "notifications"("event_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_idx" ON "device_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
