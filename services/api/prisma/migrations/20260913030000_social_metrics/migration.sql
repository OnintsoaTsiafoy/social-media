-- Sprint 12: historique append-only des relevés de métriques Meta (une ligne
-- par tentative de synchronisation, jamais mise à jour). Écrite uniquement
-- par graph-api (raw SQL) — même répartition que social_comments/
-- comment_analyses : Prisma possède le DDL, graph-api possède les écritures
-- issues de Meta. Deux index de support pour les agrégations analytics :
-- publication_targets(social_account_id, external_publication_id) permet à
-- graph-api de résoudre un publication_target_id depuis un identifiant Meta ;
-- publications(brand_id, published_at) accélère le filtrage par période.
-- Même exclusion que les migrations Sprint 06/08/09/10/11 : `prisma migrate
-- diff` propose aussi un `DROP DEFAULT` sur `id` pour toutes les tables
-- existantes, qui casserait les insertions raw-SQL reposant sur
-- gen_random_uuid().

-- CreateTable
CREATE TABLE "social_metrics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publication_target_id" UUID NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL,
    "reactions" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "reach" INTEGER,
    "impressions" INTEGER,

    CONSTRAINT "social_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_metrics_publication_target_id_collected_at_idx" ON "social_metrics"("publication_target_id", "collected_at");

-- CreateIndex
CREATE INDEX "publication_targets_social_account_id_external_publicatio_idx" ON "publication_targets"("social_account_id", "external_publication_id");

-- CreateIndex
CREATE INDEX "publications_brand_id_published_at_idx" ON "publications"("brand_id", "published_at");

-- AddForeignKey
ALTER TABLE "social_metrics" ADD CONSTRAINT "social_metrics_publication_target_id_fkey" FOREIGN KEY ("publication_target_id") REFERENCES "publication_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
