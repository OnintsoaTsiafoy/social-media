CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED', 'CANCELLED');
CREATE TYPE "PublicationTargetStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');
CREATE TYPE "DeliveryAttemptStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');
CREATE TYPE "SocialProvider" AS ENUM ('FACEBOOK', 'INSTAGRAM');
CREATE TYPE "ScheduleStatus" AS ENUM ('PENDING', 'DISPATCHED', 'CANCELLED');

ALTER TABLE "media"
  ADD COLUMN "purpose" VARCHAR(32) NOT NULL DEFAULT 'publication',
  ADD COLUMN "deleted_at" TIMESTAMPTZ(6);

CREATE TABLE "publications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "brand_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "content" TEXT NOT NULL,
  "language" VARCHAR(8) NOT NULL DEFAULT 'fr',
  "hashtags" JSONB NOT NULL DEFAULT '[]',
  "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduled_at" TIMESTAMPTZ(6),
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
  "published_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "publications_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "publications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "publications_brand_id_status_idx" ON "publications" ("brand_id", "status");
CREATE INDEX "publications_brand_id_scheduled_at_idx" ON "publications" ("brand_id", "scheduled_at");
CREATE INDEX "publications_status_scheduled_at_idx" ON "publications" ("status", "scheduled_at");
CREATE INDEX "publications_deleted_at_idx" ON "publications" ("deleted_at");

-- `social_account_id` reste nullable et sans clé étrangère : la table
-- `social_accounts` est livrée au Sprint 06 (OAuth). Le Sprint 04 cible un
-- réseau par `provider`, avec le connecteur social simulé.
CREATE TABLE "publication_targets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "publication_id" UUID NOT NULL,
  "social_account_id" UUID,
  "provider" "SocialProvider" NOT NULL,
  "adapted_content" TEXT,
  "adapted_hashtags" JSONB NOT NULL DEFAULT '[]',
  "status" "PublicationTargetStatus" NOT NULL DEFAULT 'PENDING',
  "external_publication_id" VARCHAR(255),
  "last_error_code" VARCHAR(80),
  "last_error_message" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "sent_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "publication_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "publication_targets_publication_id_provider_key" UNIQUE ("publication_id", "provider"),
  CONSTRAINT "publication_targets_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "publication_targets_status_idx" ON "publication_targets" ("status");

CREATE TABLE "publication_media" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "publication_id" UUID NOT NULL,
  "media_id" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "publication_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "publication_media_publication_id_media_id_key" UNIQUE ("publication_id", "media_id"),
  CONSTRAINT "publication_media_publication_id_position_key" UNIQUE ("publication_id", "position"),
  CONSTRAINT "publication_media_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "publication_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "publication_media_media_id_idx" ON "publication_media" ("media_id");

CREATE TABLE "scheduled_publications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "publication_id" UUID NOT NULL,
  "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
  "job_id" VARCHAR(64),
  "status" "ScheduleStatus" NOT NULL DEFAULT 'PENDING',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduled_publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "scheduled_publications_publication_id_key" UNIQUE ("publication_id"),
  CONSTRAINT "scheduled_publications_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "scheduled_publications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "scheduled_publications_status_scheduled_at_idx" ON "scheduled_publications" ("status", "scheduled_at");

CREATE TABLE "publication_delivery_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "publication_target_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "status" "DeliveryAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "error_code" VARCHAR(80),
  "error_message" TEXT,
  "external_publication_id" VARCHAR(255),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  CONSTRAINT "publication_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "publication_delivery_attempts_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "publication_delivery_attempts_target_attempt_key" UNIQUE ("publication_target_id", "attempt_number"),
  CONSTRAINT "publication_delivery_attempts_publication_target_id_fkey" FOREIGN KEY ("publication_target_id") REFERENCES "publication_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "publication_delivery_attempts_status_started_at_idx" ON "publication_delivery_attempts" ("status", "started_at");

CREATE TABLE "idempotency_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(200) NOT NULL,
  "endpoint" VARCHAR(120) NOT NULL,
  "user_id" UUID NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "response_status" INTEGER,
  "response_body" JSONB,
  "resource_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "idempotency_keys_endpoint_key_key" UNIQUE ("endpoint", "key")
);

CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" ("expires_at");
