import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CapsulesModule } from './modules/capsules/capsules.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { AdminModule } from './modules/admin/admin.module';
import { CapsuleMembersModule } from './modules/capsule-members/capsule-members.module';
import { EntriesModule } from './modules/entries/entries.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';

function validateEnvironment(environment: Record<string, unknown>) {
  const required = [
    'MAIL_HOST',
    'MAIL_PORT',
    'MAIL_USER',
    'MAIL_PASSWORD',
    'MAIL_FROM',
    'FRONTEND_URL',
  ];
  for (const key of required) {
    if (!environment[key] || String(environment[key]).trim() === '') {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  const port = Number(environment.MAIL_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MAIL_PORT must be a valid TCP port');
  }
  const maxCapsuleMembers = Number(environment.MAX_CAPSULE_MEMBERS ?? 50);
  if (!Number.isInteger(maxCapsuleMembers) || maxCapsuleMembers < 1) {
    throw new Error('MAX_CAPSULE_MEMBERS must be a positive integer');
  }
  const invitationRetentionDays = Number(
    environment.INVITATION_RETENTION_DAYS ?? 30,
  );
  if (
    !Number.isInteger(invitationRetentionDays) ||
    invitationRetentionDays < 1
  ) {
    throw new Error('INVITATION_RETENTION_DAYS must be a positive integer');
  }
  const attachmentSizeDefaults = {
    MAX_ATTACHMENT_IMAGE_SIZE_MB: 10,
    MAX_ATTACHMENT_DOCUMENT_SIZE_MB: 20,
    MAX_ATTACHMENT_AUDIO_SIZE_MB: 30,
    MAX_ATTACHMENT_VIDEO_SIZE_MB: 100,
  };
  const attachmentSizes = Object.fromEntries(
    Object.entries(attachmentSizeDefaults).map(([key, defaultValue]) => {
      const value = Number(environment[key] ?? defaultValue);
      if (!Number.isSafeInteger(value) || value < 1 || value > 2047) {
        throw new Error(`${key} must be an integer between 1 and 2047`);
      }
      return [key, value];
    }),
  );
  return {
    ...environment,
    MAX_CAPSULE_MEMBERS: maxCapsuleMembers,
    INVITATION_RETENTION_DAYS: invitationRetentionDays,
    UPLOADS_DIR: environment.UPLOADS_DIR ?? 'uploads',
    ...attachmentSizes,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    CapsulesModule,
    InvitationsModule,
    CapsuleMembersModule,
    EntriesModule,
    AttachmentsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
