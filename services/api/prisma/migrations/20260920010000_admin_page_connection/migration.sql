-- AlterTable
ALTER TABLE "oauth_states" ADD COLUMN     "select_pages" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "initiated_by_user_id" UUID;

-- CreateTable
CREATE TABLE "oauth_page_selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "initiated_by_user_id" UUID,
    "provider" "SocialProvider" NOT NULL,
    "encrypted_payload" BYTEA NOT NULL,
    "encryption_key_version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_page_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oauth_page_selections_expires_at_idx" ON "oauth_page_selections"("expires_at");

-- AddForeignKey
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_page_selections" ADD CONSTRAINT "oauth_page_selections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_page_selections" ADD CONSTRAINT "oauth_page_selections_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_page_selections" ADD CONSTRAINT "oauth_page_selections_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
