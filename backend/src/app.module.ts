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
  return {
    ...environment,
    MAX_CAPSULE_MEMBERS: maxCapsuleMembers,
    INVITATION_RETENTION_DAYS: invitationRetentionDays,
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
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
