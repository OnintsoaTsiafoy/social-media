-- Analyse concurrentielle
-- (sprint_listing/PLUS/TODO_ANALYSE_CONCURRENTIELLE_MISE_A_JOUR.md)
--
-- `id` porte DEFAULT gen_random_uuid() sur les trois tables : le worker y
-- insere en SQL brut (competitor-sync.js), comme graph-api le fait pour
-- social_metrics. Meme exclusion que les migrations precedentes : un
-- `prisma migrate diff` proposera un DROP DEFAULT sur ces colonnes, qui
-- casserait ces insertions.

CREATE TYPE "CompetitorStatus" AS ENUM ('ACTIVE', 'UNAVAILABLE', 'PERMISSION_REQUIRED', 'SYNC_ERROR');

-- Audience du compte de la marque : indispensable pour que le taux
-- d'engagement de la marque soit calculé exactement comme celui d'un
-- concurrent (interactions / abonnés). Nullable : tant qu'aucune passe n'a
-- relevé l'audience, la comparaison affiche « Non disponible ».
ALTER TABLE "social_accounts" ADD COLUMN "followers_count" INTEGER;
ALTER TABLE "social_accounts" ADD COLUMN "followers_synced_at" TIMESTAMPTZ(6);

CREATE TABLE "competitors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "brand_id" UUID NOT NULL,
  "platform" "SocialProvider" NOT NULL,
  "external_id" VARCHAR(255),
  "username" VARCHAR(255) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "profile_url" VARCHAR(1024),
  "avatar_url" VARCHAR(1024),
  "status" "CompetitorStatus" NOT NULL DEFAULT 'ACTIVE',
  "last_error_code" VARCHAR(80),
  "last_error_message" TEXT,
  "last_synced_at" TIMESTAMPTZ(6),
  "added_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "competitors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "competitors_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "competitors_added_by_user_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "competitors_brand_id_platform_username_key" ON "competitors"("brand_id", "platform", "username");
CREATE INDEX "competitors_brand_id_status_idx" ON "competitors"("brand_id", "status");
CREATE INDEX "competitors_brand_id_platform_last_synced_at_idx" ON "competitors"("brand_id", "platform", "last_synced_at");

CREATE TABLE "competitor_metrics" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "competitor_id" UUID NOT NULL,
  "collected_at" TIMESTAMPTZ(6) NOT NULL,
  "followers_count" INTEGER,
  "posts_count" INTEGER,
  "reactions_count" INTEGER,
  "comments_count" INTEGER,
  "shares_count" INTEGER,
  "engagement_rate" DECIMAL(6,4),
  CONSTRAINT "competitor_metrics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "competitor_metrics_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "competitor_metrics_competitor_id_collected_at_idx" ON "competitor_metrics"("competitor_id", "collected_at");

CREATE TABLE "competitor_posts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "competitor_id" UUID NOT NULL,
  "external_post_id" VARCHAR(255) NOT NULL,
  "message" TEXT,
  "media_type" VARCHAR(32),
  "permalink" VARCHAR(1024),
  "published_at" TIMESTAMPTZ(6),
  "reactions_count" INTEGER,
  "comments_count" INTEGER,
  "shares_count" INTEGER,
  "engagement_rate" DECIMAL(6,4),
  "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "competitor_posts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "competitor_posts_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Le ON CONFLICT de la synchronisation s'appuie sur cet index : c'est lui qui
-- garantit qu'une publication concurrente relevée deux fois est mise à jour
-- et non dupliquée.
CREATE UNIQUE INDEX "competitor_posts_competitor_id_external_post_id_key" ON "competitor_posts"("competitor_id", "external_post_id");
CREATE INDEX "competitor_posts_competitor_id_published_at_idx" ON "competitor_posts"("competitor_id", "published_at");
