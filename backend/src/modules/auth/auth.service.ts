import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { EmailService } from '../email/email.service';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

type SafeUser = {
  id: string;
  username: string | null;
  name: string;
  email: string;
  isEmailVerified: boolean;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async register(dto: RegisterDto): Promise<{ user: SafeUser }> {
    // check if username or email already exists
    const existingUser = await this.prisma.user.findFirst({
  where: {
    OR: [
      { username: dto.username },
      { email: dto.email.toLowerCase() },
    ],
  },
});

    if (existingUser) {
      throw new ConflictException('Username or email already exists');
    }


    const passwordHash = await bcrypt.hash(
      dto.password,
      this.getBcryptRounds(),
    );

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: dto.username,
            name: dto.username,
            email: dto.email.toLowerCase(),
            passwordHash,
            isEmailVerified: false,
          },
        });
        const rawToken = randomBytes(32).toString('hex');
        await tx.emailVerificationToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hashToken(rawToken),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        });
        return { user, rawToken };
      });

      await this.emailService.sendEmailVerification(
        result.user.email,
        result.rawToken,
      );
      return { user: this.toSafeUser(result.user) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Username or email already exists');
      }
      throw error;
    }
  }

  async login(
    dto: LoginDto,
  ): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    const invalidCredentials = () =>
      new UnauthorizedException('Invalid email or password');

    if (!user) {
      throw invalidCredentials();
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw invalidCredentials();
    }
    if (!user.isEmailVerified) {
      throw new UnauthorizedException('Email address is not verified');
    }

    const accessToken = await this.createAccessToken(user.id);
    const refreshToken = await this.issueRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      user: this.toSafeUser(user),
    };
  }

  async refresh(
    request: Request,
  ): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {
    this.validateCookieOrigin(request);

    const cookieName = this.getRefreshCookieName();
    const rawToken = (
      request.cookies as Record<string, string | undefined> | undefined
    )?.[cookieName];

    if (!rawToken) {
      throw new UnauthorizedException('Refresh session is missing');
    }

    let payload: { sub: string; type: 'refresh' };
    try {
      payload = await this.jwtService.verifyAsync(rawToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh session is invalid');
    }

    if (payload.type !== 'refresh' || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Refresh session is invalid');
    }

    const tokenHash = this.hashRefreshToken(rawToken);
    const now = new Date();
    const newRawRefreshToken = this.createRawRefreshToken(payload.sub);
    const newTokenHash = this.hashRefreshToken(newRawRefreshToken);
    const refreshLifetime = this.getRefreshLifetimeMilliseconds();
    const expiresAt = new Date(Date.now() + refreshLifetime);

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (
        !existing ||
        existing.userId !== payload.sub ||
        existing.expiresAt <= now ||
        existing.revokedAt
      ) {
        if (existing?.userId === payload.sub) {
          await tx.refreshToken.updateMany({
            where: { userId: payload.sub, revokedAt: null },
            data: { revokedAt: now },
          });
        }
        return { status: 'reuse' as const };
      }

      const rotated = await tx.refreshToken.updateMany({
        where: {
          id: existing.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now, lastUsedAt: now },
      });

      if (rotated.count !== 1) {
        await tx.refreshToken.updateMany({
          where: { userId: payload.sub, revokedAt: null },
          data: { revokedAt: now },
        });
        return { status: 'reuse' as const };
      }

      const replacement = await tx.refreshToken.create({
        data: {
          userId: payload.sub,
          tokenHash: newTokenHash,
          expiresAt,
        },
      });

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { replacedByTokenId: replacement.id },
      });

      return {
        status: 'ok' as const,
        user: existing.user,
      };
    });

    if (result.status === 'reuse') {
      throw new UnauthorizedException('Refresh session is invalid');
    }

    const accessToken = await this.createAccessToken(result.user.id);
    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      user: this.toSafeUser(result.user),
    };
  }

  async logout(request: Request): Promise<void> {
    this.validateCookieOrigin(request);

    const cookieName = this.getRefreshCookieName();
    const rawToken = (
      request.cookies as Record<string, string | undefined> | undefined
    )?.[cookieName];

    if (rawToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: this.hashRefreshToken(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getAuthenticatedUser(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    return this.toSafeUser(user);
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.token);
    const now = new Date();
    const token = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!token || token.usedAt || token.expiresAt <= now) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailVerificationToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException('Invalid or expired verification token');
      }
      await tx.user.update({
        where: { id: token.userId },
        data: { isEmailVerified: true },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId: token.userId, usedAt: null },
        data: { usedAt: now },
      });
    });

    return { message: 'Email verified successfully' };
  }

  async resendVerificationEmail(
    dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (user && !user.isEmailVerified) {
      const rawToken = randomBytes(32).toString('hex');
      await this.prisma.$transaction(async (tx) => {
        await tx.emailVerificationToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hashToken(rawToken),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        });
      });
      await this.emailService.sendEmailVerification(user.email, rawToken);
    }
    return { message: 'If the account exists, a verification email has been sent' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (user) {
      const rawToken = randomBytes(32).toString('hex');
      await this.prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: this.hashToken(rawToken),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        });
      });
      await this.emailService.sendPasswordReset(user.email, rawToken);
    }
    return { message: 'If the account exists, a password reset email has been sent' };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.token);
    const now = new Date();
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });
    if (!token || token.usedAt || token.expiresAt <= now) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const passwordHash = await bcrypt.hash(
      dto.password,
      this.getBcryptRounds(),
    );
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: {
          id: token.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException('Invalid or expired password reset token');
      }
      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: token.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    return { message: 'Password reset successfully' };
  }

  async issueRefreshToken(userId: string): Promise<string> {
    const rawToken = this.createRawRefreshToken(userId);
    const tokenHash = this.hashRefreshToken(rawToken);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + this.getRefreshLifetimeMilliseconds()),
      },
    });

    return rawToken;
  }

  createAccessToken(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, type: 'access' },
      {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.getOrThrow<string>(
          'JWT_ACCESS_EXPIRES_IN',
        ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );
  }

  createRefreshTokenCookieOptions() {
    const sameSite = this.configService
      .get<string>('REFRESH_TOKEN_COOKIE_SAME_SITE', 'lax')
      .toLowerCase();
    const secureValue = this.configService.get<string>(
      'REFRESH_TOKEN_COOKIE_SECURE',
      'false',
    );
    const secure =
      this.configService.get<string>('NODE_ENV') === 'production' ||
      secureValue.toLowerCase() === 'true';

    return {
      httpOnly: true,
      secure,
      sameSite: sameSite as 'lax' | 'strict' | 'none',
      path: '/auth',
      maxAge: this.getRefreshLifetimeMilliseconds(),
    };
  }

  clearRefreshTokenCookieOptions() {
    const options = this.createRefreshTokenCookieOptions();
    return {
      httpOnly: options.httpOnly,
      secure: options.secure,
      sameSite: options.sameSite,
      path: options.path,
    };
  }

  getRefreshCookieName(): string {
    return this.getRefreshCookieNameInternal();
  }

  private createRawRefreshToken(userId: string): string {
    const userPayload = randomBytes(32).toString('hex');
    return this.jwtService.sign(
      { sub: userId, nonce: userPayload, type: 'refresh' },
      {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.getOrThrow<string>(
          'JWT_REFRESH_EXPIRES_IN',
        ) as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getRefreshCookieNameInternal(): string {
    return this.configService.get<string>(
      'REFRESH_TOKEN_COOKIE_NAME',
      'memora_refresh',
    );
  }

  private getBcryptRounds(): number {
    const rounds = this.configService.get<number>('BCRYPT_ROUNDS', 12);
    return Number.isInteger(rounds) && rounds >= 10 && rounds <= 14
      ? rounds
      : 12;
  }

  private getRefreshLifetimeMilliseconds(): number {
    const value = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) {
      throw new Error('JWT_REFRESH_EXPIRES_IN must use s, m, h, or d');
    }

    const amount = Number(match[1]);
    const unitMilliseconds: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return amount * unitMilliseconds[match[2]];
  }

  private validateCookieOrigin(request: Request): void {
    const trustedOrigins = (
      this.configService.get<string>('TRUSTED_ORIGINS') ?? ''
    )
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (trustedOrigins.length === 0) {
      return;
    }

    const origin = request.headers.origin;
    if (origin && !trustedOrigins.includes(origin)) {
      throw new UnauthorizedException('Invalid request origin');
    }
  }

  private toSafeUser(user: {
    id: string;
    username: string | null;
    name: string;
    email: string;
    isEmailVerified: boolean;
  }): SafeUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
    };
  }
}
