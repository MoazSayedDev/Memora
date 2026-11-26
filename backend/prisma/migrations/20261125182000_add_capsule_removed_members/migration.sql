CREATE TABLE "capsule_removed_members" (
    "capsule_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "removed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capsule_removed_members_pkey" PRIMARY KEY ("capsule_id", "user_id")
);

CREATE INDEX "capsule_removed_members_user_id_idx"
ON "capsule_removed_members"("user_id");

ALTER TABLE "capsule_removed_members"
ADD CONSTRAINT "capsule_removed_members_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
