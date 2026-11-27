ALTER TYPE "CapsuleStatus" ADD VALUE 'CLOSED';

ALTER TABLE "capsules"
ADD COLUMN "close_at" TIMESTAMP(3),
ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "opened_at" TIMESTAMP(3);

ALTER TABLE "capsules"
ADD CONSTRAINT "capsules_close_before_open_check"
CHECK ("close_at" IS NULL OR ("opens_at" IS NOT NULL AND "close_at" < "opens_at"));

CREATE INDEX "capsules_status_close_at_idx" ON "capsules"("status", "close_at");

ALTER TABLE "entry_attachments"
ADD COLUMN "uploaded_by_id" UUID,
ADD COLUMN "original_name" TEXT;

CREATE INDEX "entry_attachments_uploaded_by_id_idx"
ON "entry_attachments"("uploaded_by_id");

ALTER TABLE "entry_attachments"
ADD CONSTRAINT "entry_attachments_uploaded_by_id_fkey"
FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
