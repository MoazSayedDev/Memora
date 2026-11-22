CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "capsules" DROP CONSTRAINT "capsules_owner_id_fkey";
ALTER TABLE "invitation_links" DROP CONSTRAINT "invitation_links_capsule_id_fkey";
ALTER TABLE "invitation_links" DROP CONSTRAINT "invitation_links_created_by_fkey";
ALTER TABLE "capsule_members" DROP CONSTRAINT "capsule_members_capsule_id_fkey";
ALTER TABLE "capsule_members" DROP CONSTRAINT "capsule_members_user_id_fkey";
ALTER TABLE "capsule_entries" DROP CONSTRAINT "capsule_entries_capsule_member_id_fkey";
ALTER TABLE "entry_attachments" DROP CONSTRAINT "entry_attachments_entry_id_fkey";
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_replaced_by_token_id_fkey";

ALTER TABLE "users" ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "capsules" ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "capsules" ADD COLUMN "new_owner_id" UUID;
ALTER TABLE "invitation_links" ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "invitation_links" ADD COLUMN "new_capsule_id" UUID;
ALTER TABLE "invitation_links" ADD COLUMN "new_created_by" UUID;
ALTER TABLE "capsule_members" ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "capsule_members" ADD COLUMN "new_capsule_id" UUID;
ALTER TABLE "capsule_members" ADD COLUMN "new_user_id" UUID;
ALTER TABLE "capsule_entries" ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "capsule_entries" ADD COLUMN "new_capsule_member_id" UUID;
ALTER TABLE "entry_attachments" ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "entry_attachments" ADD COLUMN "new_entry_id" UUID;
ALTER TABLE "refresh_tokens" ADD COLUMN "new_id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "refresh_tokens" ADD COLUMN "new_user_id" UUID;
ALTER TABLE "refresh_tokens" ADD COLUMN "new_replaced_by_token_id" UUID;

UPDATE "capsules" c SET "new_owner_id" = u."new_id"
FROM "users" u WHERE u."id" = c."owner_id";
UPDATE "invitation_links" i SET "new_capsule_id" = c."new_id"
FROM "capsules" c WHERE c."id" = i."capsule_id";
UPDATE "invitation_links" i SET "new_created_by" = u."new_id"
FROM "users" u WHERE u."id" = i."created_by";
UPDATE "capsule_members" m SET "new_capsule_id" = c."new_id"
FROM "capsules" c WHERE c."id" = m."capsule_id";
UPDATE "capsule_members" m SET "new_user_id" = u."new_id"
FROM "users" u WHERE u."id" = m."user_id";
UPDATE "capsule_entries" e SET "new_capsule_member_id" = m."new_id"
FROM "capsule_members" m WHERE m."id" = e."capsule_member_id";
UPDATE "entry_attachments" a SET "new_entry_id" = e."new_id"
FROM "capsule_entries" e WHERE e."id" = a."entry_id";
UPDATE "refresh_tokens" r SET "new_user_id" = u."new_id"
FROM "users" u WHERE u."id" = r."user_id";
UPDATE "refresh_tokens" r SET "new_replaced_by_token_id" = replaced."new_id"
FROM "refresh_tokens" replaced WHERE replaced."id" = r."replaced_by_token_id";

ALTER TABLE "users" DROP CONSTRAINT "users_pkey";
ALTER TABLE "capsules" DROP CONSTRAINT "capsules_pkey";
ALTER TABLE "invitation_links" DROP CONSTRAINT "invitation_links_pkey";
ALTER TABLE "capsule_members" DROP CONSTRAINT "capsule_members_pkey";
ALTER TABLE "capsule_entries" DROP CONSTRAINT "capsule_entries_pkey";
ALTER TABLE "entry_attachments" DROP CONSTRAINT "entry_attachments_pkey";
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_pkey";

ALTER TABLE "users" DROP COLUMN "id";
ALTER TABLE "users" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "capsules" DROP COLUMN "id";
ALTER TABLE "capsules" DROP COLUMN "owner_id";
ALTER TABLE "capsules" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "capsules" RENAME COLUMN "new_owner_id" TO "owner_id";
ALTER TABLE "capsules" ALTER COLUMN "owner_id" SET NOT NULL;
ALTER TABLE "capsules" ADD CONSTRAINT "capsules_pkey" PRIMARY KEY ("id");
ALTER TABLE "capsules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "invitation_links" DROP COLUMN "id";
ALTER TABLE "invitation_links" DROP COLUMN "capsule_id";
ALTER TABLE "invitation_links" DROP COLUMN "created_by";
ALTER TABLE "invitation_links" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "invitation_links" RENAME COLUMN "new_capsule_id" TO "capsule_id";
ALTER TABLE "invitation_links" RENAME COLUMN "new_created_by" TO "created_by";
ALTER TABLE "invitation_links" ALTER COLUMN "capsule_id" SET NOT NULL;
ALTER TABLE "invitation_links" ALTER COLUMN "created_by" SET NOT NULL;
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_pkey" PRIMARY KEY ("id");
ALTER TABLE "invitation_links" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "capsule_members" DROP COLUMN "id";
ALTER TABLE "capsule_members" DROP COLUMN "capsule_id";
ALTER TABLE "capsule_members" DROP COLUMN "user_id";
ALTER TABLE "capsule_members" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "capsule_members" RENAME COLUMN "new_capsule_id" TO "capsule_id";
ALTER TABLE "capsule_members" RENAME COLUMN "new_user_id" TO "user_id";
ALTER TABLE "capsule_members" ALTER COLUMN "capsule_id" SET NOT NULL;
ALTER TABLE "capsule_members" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "capsule_members" ADD CONSTRAINT "capsule_members_pkey" PRIMARY KEY ("id");
ALTER TABLE "capsule_members" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "capsule_entries" DROP COLUMN "id";
ALTER TABLE "capsule_entries" DROP COLUMN "capsule_member_id";
ALTER TABLE "capsule_entries" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "capsule_entries" RENAME COLUMN "new_capsule_member_id" TO "capsule_member_id";
ALTER TABLE "capsule_entries" ALTER COLUMN "capsule_member_id" SET NOT NULL;
ALTER TABLE "capsule_entries" ADD CONSTRAINT "capsule_entries_pkey" PRIMARY KEY ("id");
ALTER TABLE "capsule_entries" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "entry_attachments" DROP COLUMN "id";
ALTER TABLE "entry_attachments" DROP COLUMN "entry_id";
ALTER TABLE "entry_attachments" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "entry_attachments" RENAME COLUMN "new_entry_id" TO "entry_id";
ALTER TABLE "entry_attachments" ALTER COLUMN "entry_id" SET NOT NULL;
ALTER TABLE "entry_attachments" ADD CONSTRAINT "entry_attachments_pkey" PRIMARY KEY ("id");
ALTER TABLE "entry_attachments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "refresh_tokens" DROP COLUMN "id";
ALTER TABLE "refresh_tokens" DROP COLUMN "user_id";
ALTER TABLE "refresh_tokens" DROP COLUMN "replaced_by_token_id";
ALTER TABLE "refresh_tokens" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "refresh_tokens" RENAME COLUMN "new_user_id" TO "user_id";
ALTER TABLE "refresh_tokens" RENAME COLUMN "new_replaced_by_token_id" TO "replaced_by_token_id";
ALTER TABLE "refresh_tokens" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id");
ALTER TABLE "refresh_tokens" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

CREATE INDEX "capsules_owner_id_idx" ON "capsules"("owner_id");
CREATE INDEX "capsule_members_capsule_id_idx" ON "capsule_members"("capsule_id");
CREATE INDEX "capsule_members_user_id_idx" ON "capsule_members"("user_id");
CREATE UNIQUE INDEX "capsule_members_capsule_id_user_id_key" ON "capsule_members"("capsule_id", "user_id");
CREATE INDEX "capsule_entries_capsule_member_id_idx" ON "capsule_entries"("capsule_member_id");
CREATE INDEX "entry_attachments_entry_id_idx" ON "entry_attachments"("entry_id");
CREATE INDEX "invitation_links_capsule_id_idx" ON "invitation_links"("capsule_id");
CREATE INDEX "invitation_links_created_by_idx" ON "invitation_links"("created_by");
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_replaced_by_token_id_idx" ON "refresh_tokens"("replaced_by_token_id");

ALTER TABLE "capsules" ADD CONSTRAINT "capsules_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_capsule_id_fkey" FOREIGN KEY ("capsule_id") REFERENCES "capsules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capsule_members" ADD CONSTRAINT "capsule_members_capsule_id_fkey" FOREIGN KEY ("capsule_id") REFERENCES "capsules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capsule_members" ADD CONSTRAINT "capsule_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "capsule_entries" ADD CONSTRAINT "capsule_entries_capsule_member_id_fkey" FOREIGN KEY ("capsule_member_id") REFERENCES "capsule_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entry_attachments" ADD CONSTRAINT "entry_attachments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "capsule_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_token_id_fkey" FOREIGN KEY ("replaced_by_token_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
