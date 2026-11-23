import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

jest.mock('@nestjs/passport', () => ({
  AuthGuard: () =>
    class {
      canActivate(context: ExecutionContext) {
        return Boolean(context.switchToHttp().getRequest().user);
      }
    },
}));

import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('allows explicitly public handlers', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects missing or invalid authenticated users', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    expect(() => guard.handleRequest(new Error('invalid'), null)).toThrow(
      'invalid',
    );
    expect(() => guard.handleRequest(null, false)).toThrow(
      UnauthorizedException,
    );
  });

  it('attaches the validated authenticated user unchanged', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const user = { id: '550e8400-e29b-41d4-a716-446655440000' };

    expect(guard.handleRequest(null, user)).toBe(user);
  });
});
