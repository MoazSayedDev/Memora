/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unused-vars */
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../../../../src/modules/auth/strategies/jwt.strategy';

jest.mock('@nestjs/config', () => ({
  ConfigService: class {},
}));
jest.mock('@nestjs/passport', () => ({
  PassportStrategy: (Strategy: any) =>
    class {
      constructor(options: any) {
        Object.assign(this, { options });
      }
    },
}));
jest.mock('passport-jwt', () => ({
  ExtractJwt: { fromAuthHeaderAsBearerToken: jest.fn() },
  Strategy: class {},
}));

describe('JwtStrategy', () => {
  it('uses an active refresh session and rejects invalid payload types', async () => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('access-secret'),
    } as unknown as ConfigService;
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          userId: '550e8400-e29b-41d4-a716-446655440000',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    };
    const strategy = new JwtStrategy(configService, prisma as any);

    const userId = '550e8400-e29b-41d4-a716-446655440000';
    const sessionId = '550e8400-e29b-41d4-a716-446655440001';
    await expect(
      strategy.validate({ sub: userId, sid: sessionId, type: 'access' }),
    ).resolves.toEqual({ id: userId });
    await expect(
      strategy.validate({ sub: userId, sid: sessionId, type: 'refresh' as any }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      strategy.validate({
        sub: 'spoofed-user-id',
        sid: sessionId,
        type: 'access',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an access token whose session was revoked', async () => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('access-secret'),
    } as unknown as ConfigService;
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          userId: '550e8400-e29b-41d4-a716-446655440000',
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    };
    const strategy = new JwtStrategy(configService, prisma as any);

    await expect(
      strategy.validate({
        sub: '550e8400-e29b-41d4-a716-446655440000',
        sid: '550e8400-e29b-41d4-a716-446655440001',
        type: 'access',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
