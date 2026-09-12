-- Sprint 06: OAuth Meta, multi-account social accounts, encrypted tokens.
--
-- Note: the raw `prisma migrate diff` output also proposed dropping the
-- DB-level `DEFAULT gen_random_uuid()` on every existing table's `id` column
-- (and `DEFAULT` on a couple of `updated_at` columns). That drift is
-- unrelated to this schema change — Prisma Client generates ids
-- client-side and never depended on it — but `services/worker` writes to
-- these tables via raw SQL and must keep being able to rely on it, so those
-- unrelated statements were deliberately excluded from this migration.

-- CreateEnum
CREATE TYPE "SocialAccountStatus" AS ENUM ('CONNECTED', 'EXPIRING', 'EXPIRED', 'REAUTH_REQUIRED', 'REVOKED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SocialAccountAuthMethod" AS ENUM ('FACEBOOK_PAGE', 'INSTAGRAM_LOGIN');

-- CreateEnum
CREATE TYPE "OAuthTokenStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SocialPermissionStatus" AS ENUM ('GRANTED', 'DECLINED');

-- DropConstraint
-- Was one target per (publication, provider): structurally forbade two
-- accounts of the same network on one publication. Replaced below by a
-- per-account constraint now that social_accounts exists.
ALTER TABLE "publication_targets" DROP CONSTRAINT "publication_targets_publication_id_provider_key";

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "brand_id" UUID NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "external_account_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "username" VARCHAR(255),
    "avatar_url" VARCHAR(1024),
    "status" "SocialAccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "auth_method" "SocialAccountAuthMethod" NOT NULL,
    "connected_by_user_id" UUID NOT NULL,
    "last_comments_sync_at" TIMESTAMPTZ(6),
    "last_metrics_sync_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "social_account_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "OAuthTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "encrypted_access_token" BYTEA NOT NULL,
    "encrypted_refresh_token" BYTEA,
    "encryption_key_version" INTEGER NOT NULL DEFAULT 1,
    "scope" JSONB NOT NULL DEFAULT '[]',
    "expires_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(80),
    "last_error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "social_account_id" UUID NOT NULL,
    "permission" VARCHAR(120) NOT NULL,
    "status" "SocialPermissionStatus" NOT NULL DEFAULT 'GRANTED',
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "state_hash" VARCHAR(128) NOT NULL,
    "user_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "provider" "SocialProvider" NOT NULL,
    "mobile_redirect_uri" VARCHAR(2048) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(200) NOT NULL,
    "endpoint" VARCHAR(120) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_accounts_brand_id_status_idx" ON "social_accounts"("brand_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_provider_external_account_id_key" ON "social_accounts"("provider", "external_account_id");

-- CreateIndex
CREATE INDEX "oauth_tokens_social_account_id_status_idx" ON "oauth_tokens"("social_account_id", "status");

-- CreateIndex
CREATE INDEX "oauth_tokens_status_expires_at_idx" ON "oauth_tokens"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_social_account_id_version_key" ON "oauth_tokens"("social_account_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "social_permissions_social_account_id_permission_key" ON "social_permissions"("social_account_id", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_state_hash_key" ON "oauth_states"("state_hash");

-- CreateIndex
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");

-- CreateIndex
CREATE INDEX "service_idempotency_keys_expires_at_idx" ON "service_idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_idempotency_keys_endpoint_key_key" ON "service_idempotency_keys"("endpoint", "key");

-- CreateIndex
CREATE INDEX "publication_targets_publication_id_provider_idx" ON "publication_targets"("publication_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "publication_targets_publication_id_social_account_id_key" ON "publication_targets"("publication_id", "social_account_id");

-- AddForeignKey
ALTER TABLE "publication_targets" ADD CONSTRAINT "publication_targets_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_permissions" ADD CONSTRAINT "social_permissions_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
