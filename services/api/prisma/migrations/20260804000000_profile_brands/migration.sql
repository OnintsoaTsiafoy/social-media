CREATE TYPE "BrandMemberRole" AS ENUM ('OWNER', 'ADMIN', 'COMMUNITY_MANAGER', 'VIEWER');
CREATE TYPE "BrandStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AiTone" AS ENUM ('PROFESSIONAL', 'FRIENDLY', 'EMPATHETIC', 'FORMAL', 'CUSTOM');
CREATE TYPE "AiFormality" AS ENUM ('INFORMAL', 'FORMAL', 'ADAPTIVE');

ALTER TABLE "users"
  ADD COLUMN "phone" VARCHAR(30),
  ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "avatar_media_id" UUID;

CREATE TABLE "brands" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "industry" VARCHAR(100),
  "primary_language" VARCHAR(8) NOT NULL DEFAULT 'fr',
  "status" "BrandStatus" NOT NULL DEFAULT 'ACTIVE',
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brands_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brands_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "brand_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "brand_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "BrandMemberRole" NOT NULL DEFAULT 'VIEWER',
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brand_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brand_members_brand_id_user_id_key" UNIQUE ("brand_id", "user_id"),
  CONSTRAINT "brand_members_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "brand_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "brand_ai_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "brand_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "tone" "AiTone" NOT NULL DEFAULT 'PROFESSIONAL',
  "custom_tone" TEXT,
  "formality" "AiFormality" NOT NULL DEFAULT 'ADAPTIVE',
  "language" VARCHAR(8) NOT NULL DEFAULT 'fr',
  "emojis_allowed" BOOLEAN NOT NULL DEFAULT true,
  "target_length" VARCHAR(32) NOT NULL DEFAULT '2 phrases',
  "greeting" VARCHAR(300),
  "closing" VARCHAR(300),
  "forbidden_terms" JSONB NOT NULL DEFAULT '[]',
  "recommended_terms" JSONB NOT NULL DEFAULT '[]',
  "instructions" TEXT,
  "complaint_instructions" TEXT,
  "urgency_instructions" TEXT,
  "support_instructions" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brand_ai_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brand_ai_settings_brand_id_version_key" UNIQUE ("brand_id", "version"),
  CONSTRAINT "brand_ai_settings_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "brand_ai_settings_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "media" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID,
  "brand_id" UUID,
  "bucket" VARCHAR(100) NOT NULL DEFAULT 'hootly',
  "object_key" VARCHAR(1024) NOT NULL,
  "mime_type" VARCHAR(127) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "status" VARCHAR(32) NOT NULL DEFAULT 'READY',
  "checksum" VARCHAR(128),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "media_object_key_key" UNIQUE ("object_key"),
  CONSTRAINT "media_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "media_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "users"
  ADD CONSTRAINT "users_avatar_media_id_fkey" FOREIGN KEY ("avatar_media_id") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "users_avatar_media_id_key" ON "users"("avatar_media_id");
CREATE INDEX "brands_owner_user_id_idx" ON "brands"("owner_user_id");
CREATE INDEX "brands_deleted_at_idx" ON "brands"("deleted_at");
CREATE INDEX "brand_members_user_id_is_active_idx" ON "brand_members"("user_id", "is_active");
CREATE INDEX "brand_members_brand_id_role_idx" ON "brand_members"("brand_id", "role");
CREATE UNIQUE INDEX "brand_members_one_active_per_user_key" ON "brand_members"("user_id") WHERE "is_active" = true;
CREATE INDEX "brand_ai_settings_brand_id_created_at_idx" ON "brand_ai_settings"("brand_id", "created_at");
CREATE INDEX "media_owner_user_id_created_at_idx" ON "media"("owner_user_id", "created_at");
CREATE INDEX "media_brand_id_created_at_idx" ON "media"("brand_id", "created_at");
