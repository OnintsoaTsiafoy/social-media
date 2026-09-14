-- CreateEnum
CREATE TYPE "PublicationApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PublicationStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "PublicationStatus" ADD VALUE 'APPROVED';
ALTER TYPE "PublicationStatus" ADD VALUE 'REJECTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PUBLICATION_APPROVAL_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'PUBLICATION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'PUBLICATION_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'PUBLICATION_CHANGES_REQUESTED';

-- AlterTable
ALTER TABLE "publications" ADD COLUMN     "approved_revision" INTEGER,
ADD COLUMN     "content_revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "publication_approval" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "publication_approvals" (
    "id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "reviewer_id" UUID,
    "revision" INTEGER NOT NULL,
    "status" "PublicationApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" VARCHAR(2000),
    "request_comment" VARCHAR(2000),
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "publication_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publication_approvals_publication_id_requested_at_idx" ON "publication_approvals"("publication_id", "requested_at");

-- CreateIndex
CREATE INDEX "publication_approvals_reviewer_id_status_idx" ON "publication_approvals"("reviewer_id", "status");

-- CreateIndex
CREATE INDEX "publication_approvals_status_requested_at_idx" ON "publication_approvals"("status", "requested_at");

-- AddForeignKey
ALTER TABLE "publication_approvals" ADD CONSTRAINT "publication_approvals_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_approvals" ADD CONSTRAINT "publication_approvals_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_approvals" ADD CONSTRAINT "publication_approvals_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one open request for a publication, including concurrent submissions.
CREATE UNIQUE INDEX publication_approvals_one_pending ON publication_approvals(publication_id) WHERE status = 'PENDING';
