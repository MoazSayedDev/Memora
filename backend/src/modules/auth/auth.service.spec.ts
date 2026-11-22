/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

jest.mock('@nestjs/config', () => ({
  ConfigService: class {},
}));
jest.mock('@nestjs/jwt', () => ({
  JwtService: class {},
}));
jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
      }
    },
  },
}));
jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AuthService', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000';
  const refreshTokenId = '550e8400-e29b-41d4-a716-446655440001';
  const replacementTokenId = '550e8400-e29b-41d4-a716-446655440002';
  const safeUser = {
    id: userId,
    username: 'memora_user',
    name: 'memora_user',
    email: 'user@memora.test',
    isEmailVerified: true,
  };

  let prisma: any;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let emailService: { sendEmailVerification: jest.Mock; sendPasswordReset: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      refreshToken: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      emailVerificationToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      passwordResetToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('access-token'),
      sign: jest.fn().mockReturnValue('refresh-token'),
      verifyAsync: jest.fn(),
    } as any;

    configService = {
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          JWT_ACCESS_SECRET: 'access-secret',
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return values[key];
      }),
      get: jest.fn((key: string, defaultValue?: unknown) => {
        const values: Record<string, unknown> = {
          BCRYPT_ROUNDS: 12,
          NODE_ENV: 'test',
          REFRESH_TOKEN_COOKIE_NAME: 'memora_refresh',
          REFRESH_TOKEN_COOKIE_SECURE: 'false',
          REFRESH_TOKEN_COOKIE_SAME_SITE: 'lax',
          TRUSTED_ORIGINS: 'http://localhost:3000',
        };
        return values[key] ?? defaultValue;
      }),
    } as any;

    emailService = {
      sendEmailVerification: jest.fn().mockResolvedValue(undefined),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(
      prisma,
      jwtService,
      configService,
      emailService as any,
    );
  });

  it('registers a user and does not expose the password hash', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('password-hash');
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        user: {
          create: jest.fn().mockResolvedValue({
            ...safeUser,
            isEmailVerified: false,
            passwordHash: 'password-hash',
          }),
        },
        emailVerificationToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({ id: 'verification-token-id' }),
        },
      }),
    );
    prisma.user.create.mockResolvedValue({
      ...safeUser,
      passwordHash: 'password-hash',
    });

    const result = await service.register({
      username: 'memora_user',
      email: 'User@Memora.test',
      password: 'password123',
    });

    expect(emailService.sendEmailVerification).toHaveBeenCalled();
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('reports duplicate email or username registration as a conflict', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('password-hash');
    const { Prisma } = jest.requireMock('@prisma/client');
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002' },
    );
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        user: {
          create: jest.fn().mockRejectedValue(error),
        },
        emailVerificationToken: {
          updateMany: jest.fn(),
          create: jest.fn(),
        },
      }),
    );

    await expect(
      service.register({
        username: 'memora_user',
        email: 'user@memora.test',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs in with valid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...safeUser,
      passwordHash: 'password-hash',
    });
    prisma.refreshToken.create.mockResolvedValue({ id: refreshTokenId });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.login({
      email: 'user@memora.test',
      password: 'password123',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(prisma.refreshToken.create).toHaveBeenCalled();
  });

  it('rejects an invalid password generically', async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...safeUser,
      passwordHash: 'password-hash',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.login({
        email: 'user@memora.test',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates a valid refresh token successfully', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: userId,
      type: 'refresh',
    } as any);
    prisma.$transaction.mockImplementation(async (callback: any) => {
      return callback({
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue({
            id: refreshTokenId,
            userId,
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            user: { ...safeUser, passwordHash: 'password-hash' },
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockResolvedValue({ id: replacementTokenId }),
          update: jest.fn().mockResolvedValue({ id: refreshTokenId }),
        },
      });
    });

    const result = await service.refresh({
      cookies: { memora_refresh: 'valid-refresh-token' },
      headers: { origin: 'http://localhost:3000' },
    } as any);

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
  });

  it('rejects an expired refresh token', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: userId,
      type: 'refresh',
    } as any);
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue({
            id: refreshTokenId,
            userId,
            expiresAt: new Date(Date.now() - 60_000),
            revokedAt: null,
            user: { ...safeUser, passwordHash: 'password-hash' },
          }),
          updateMany: jest.fn(),
        },
      }),
    );

    await expect(
      service.refresh({
        cookies: { memora_refresh: 'expired-refresh-token' },
        headers: { origin: 'http://localhost:3000' },
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked refresh token and revokes active sessions', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: userId,
      type: 'refresh',
    } as any);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue({
            id: refreshTokenId,
            userId,
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: new Date(),
            user: safeUser,
          }),
          updateMany,
        },
      }),
    );

    await expect(
      service.refresh({
        cookies: { memora_refresh: 'revoked-refresh-token' },
        headers: { origin: 'http://localhost:3000' },
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updateMany).toHaveBeenCalled();
  });

  it('detects concurrent refresh reuse and revokes the user sessions', async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: userId,
      type: 'refresh',
    } as any);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        refreshToken: {
          findUnique: jest.fn().mockResolvedValue({
            id: refreshTokenId,
            userId,
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            user: safeUser,
          }),
          updateMany,
        },
      }),
    );

    await expect(
      service.refresh({
        cookies: { memora_refresh: 'already-used-refresh-token' },
        headers: { origin: 'http://localhost:3000' },
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes the current refresh token on logout safely', async () => {
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.logout({
        cookies: { memora_refresh: 'refresh-token' },
        headers: { origin: 'http://localhost:3000' },
      } as any),
    ).resolves.toBeUndefined();
  });

  it('revokes all active refresh tokens for logout-all', async () => {
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    await service.logoutAll(userId);

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId, revokedAt: null },
      }),
    );
  });

  it('verifies a valid email token and rejects reuse', async () => {
    const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const stored = {
      id: 'verification-token-id',
      userId,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    prisma.emailVerificationToken.findUnique.mockResolvedValue(stored);
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        emailVerificationToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        user: { update: jest.fn().mockResolvedValue(safeUser) },
      }),
    );

    await expect(service.verifyEmail({ token })).resolves.toEqual({
      message: 'Email verified successfully',
    });

    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      ...stored,
      usedAt: new Date(),
    });
    await expect(service.verifyEmail({ token })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects invalid and expired email verification tokens', async () => {
    const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    prisma.emailVerificationToken.findUnique.mockResolvedValue(null);
    await expect(service.verifyEmail({ token })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'verification-token-id',
      userId,
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.verifyEmail({ token })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resets a password and revokes refresh tokens', async () => {
    const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reset-token-id',
      userId,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-password-hash');
    const refreshUpdate = jest.fn().mockResolvedValue({ count: 2 });
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback({
        passwordResetToken: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        user: { update: jest.fn().mockResolvedValue(safeUser) },
        refreshToken: { updateMany: refreshUpdate },
      }),
    );

    await expect(
      service.resetPassword({ token, password: 'new-password123' }),
    ).resolves.toEqual({ message: 'Password reset successfully' });
    expect(refreshUpdate).toHaveBeenCalled();
  });

  it('returns generic forgot-password responses', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.forgotPassword({ email: 'unknown@memora.test' }),
    ).resolves.toEqual({
      message: 'If the account exists, a password reset email has been sent',
    });
  });

  it('rejects invalid, expired, and reused password reset tokens', async () => {
    const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    prisma.passwordResetToken.findUnique.mockResolvedValue(null);
    await expect(
      service.resetPassword({ token, password: 'new-password123' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'expired-token',
      userId,
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      service.resetPassword({ token, password: 'new-password123' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 'reused-token',
      userId,
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      service.resetPassword({ token, password: 'new-password123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
