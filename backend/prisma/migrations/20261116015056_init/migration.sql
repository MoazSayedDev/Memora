-- CreateEnum
CREATE TYPE "CapsuleType" AS ENUM ('PERSONAL', 'GROUP');

-- CreateEnum
CREATE TYPE "CapsuleStatus" AS ENUM ('DRAFT', 'COLLECTING', 'OPEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsules" (
    "id" SERIAL NOT NULL,
    "owner_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cover" TEXT,
    "type" "CapsuleType" NOT NULL,
    "opens_at" TIMESTAMP(3),
    "status" "CapsuleStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capsules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_links" (
    "id" SERIAL NOT NULL,
    "capsule_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_uses" INTEGER,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsule_members" (
    "id" SERIAL NOT NULL,
    "capsule_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "MemberRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capsule_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capsule_entries" (
    "id" SERIAL NOT NULL,
    "capsule_member_id" INTEGER NOT NULL,
    "text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capsule_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entry_attachments" (
    "id" SERIAL NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "type" "AttachmentType" NOT NULL,
    "file_url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "duration" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "replaced_by_token_id" INTEGER,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "capsules_owner_id_idx" ON "capsules"("owner_id");

-- CreateIndex
CREATE INDEX "capsules_status_opens_at_idx" ON "capsules"("status", "opens_at");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_links_token_hash_key" ON "invitation_links"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_links_capsule_id_idx" ON "invitation_links"("capsule_id");

-- CreateIndex
CREATE INDEX "invitation_links_created_by_idx" ON "invitation_links"("created_by");

-- CreateIndex
CREATE INDEX "invitation_links_status_expires_at_idx" ON "invitation_links"("status", "expires_at");

-- CreateIndex
CREATE INDEX "capsule_members_capsule_id_idx" ON "capsule_members"("capsule_id");

-- CreateIndex
CREATE INDEX "capsule_members_user_id_idx" ON "capsule_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "capsule_members_capsule_id_user_id_key" ON "capsule_members"("capsule_id", "user_id");

-- CreateIndex
CREATE INDEX "capsule_entries_capsule_member_id_idx" ON "capsule_entries"("capsule_member_id");

-- CreateIndex
CREATE INDEX "entry_attachments_entry_id_idx" ON "entry_attachments"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_replaced_by_token_id_idx" ON "refresh_tokens"("replaced_by_token_id");

-- AddForeignKey
ALTER TABLE "capsules" ADD CONSTRAINT "capsules_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_capsule_id_fkey" FOREIGN KEY ("capsule_id") REFERENCES "capsules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_links" ADD CONSTRAINT "invitation_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_members" ADD CONSTRAINT "capsule_members_capsule_id_fkey" FOREIGN KEY ("capsule_id") REFERENCES "capsules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_members" ADD CONSTRAINT "capsule_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capsule_entries" ADD CONSTRAINT "capsule_entries_capsule_member_id_fkey" FOREIGN KEY ("capsule_member_id") REFERENCES "capsule_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_attachments" ADD CONSTRAINT "entry_attachments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "capsule_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_token_id_fkey" FOREIGN KEY ("replaced_by_token_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
