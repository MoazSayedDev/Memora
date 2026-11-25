import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CapsulesModule } from './modules/capsules/capsules.module';
import { InvitationsModule } from './modules/invitations/invitations.module';

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
  return environment;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CapsulesModule,
    InvitationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
