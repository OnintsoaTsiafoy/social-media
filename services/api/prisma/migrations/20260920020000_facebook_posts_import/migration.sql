-- Import des publications d'une Page Facebook (synchronisation initiale, puis
-- incrémentale) : une publication déjà présente sur le réseau devient une ligne
-- `publications` (origin = 'IMPORTED', statut PUBLISHED) + une ligne
-- `publication_targets` (statut SENT) — donc les mêmes commentaires, métriques et
-- analytics que celles composées dans Hootly. Écrite uniquement par graph-api
-- (raw SQL), même répartition que social_comments / social_metrics.
-- Même exclusion que les migrations précédentes : `prisma migrate diff` propose
-- aussi un `DROP DEFAULT` sur `id`, qui casserait les insertions raw-SQL reposant
-- sur gen_random_uuid().

-- CreateEnum
CREATE TYPE "PublicationOrigin" AS ENUM ('HOOTLY', 'IMPORTED');

-- AlterTable
ALTER TABLE "publications" ADD COLUMN "origin" "PublicationOrigin" NOT NULL DEFAULT 'HOOTLY';

-- AlterTable
ALTER TABLE "publication_targets" ADD COLUMN "external_url" VARCHAR(2048);

-- AlterTable
ALTER TABLE "social_accounts" ADD COLUMN "last_posts_sync_at" TIMESTAMPTZ(6);

-- Clé de dédoublonnage de l'import : un post Meta ne correspond qu'à UNE cible par
-- compte, qu'il ait été publié par Hootly ou importé. Les lignes sans identifiant
-- externe (brouillons, envois en cours) ne sont pas concernées : NULL n'est jamais
-- égal à NULL dans un index unique PostgreSQL. Remplace l'index simple
-- (mêmes colonnes) ajouté au Sprint 12 pour la résolution des métriques.
DROP INDEX "publication_targets_social_account_id_external_publicatio_idx";

-- CreateIndex
CREATE UNIQUE INDEX "publication_targets_account_external_key" ON "publication_targets"("social_account_id", "external_publication_id");
