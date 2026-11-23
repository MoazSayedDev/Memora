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
  it('uses the authenticated JWT subject and rejects invalid payload types', () => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('access-secret'),
    } as unknown as ConfigService;
    const strategy = new JwtStrategy(configService);

    const userId = '550e8400-e29b-41d4-a716-446655440000';
    expect(strategy.validate({ sub: userId, type: 'access' })).toEqual({ id: userId });
    expect(() =>
      strategy.validate({ sub: userId, type: 'refresh' as any }),
    ).toThrow(UnauthorizedException);
    expect(() =>
      strategy.validate({ sub: 'spoofed-user-id', type: 'access' }),
    ).toThrow(UnauthorizedException);
  });
});
