import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';

jest.mock('../src/modules/auth/auth.service', () => ({
  AuthService: class {},
}));

import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';

const authService = {
  register: jest.fn().mockResolvedValue({ user: { id: 'user-id' } }),
  verifyEmail: jest.fn().mockResolvedValue({ verified: true }),
  resetPassword: jest.fn().mockResolvedValue(undefined),
  login: jest.fn().mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    user: { id: 'user-id' },
  }),
  refresh: jest.fn().mockResolvedValue({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    user: { id: 'user-id' },
  }),
  getRefreshCookieName: jest.fn().mockReturnValue('refresh_token'),
  createRefreshTokenCookieOptions: jest
    .fn()
    .mockReturnValue({ httpOnly: true }),
};

const throttledRoutes = [
  {
    path: 'login',
    limit: 5,
    status: 200,
    body: { email: 'user@example.test', password: 'valid-password' },
  },
  {
    path: 'register',
    limit: 10,
    status: 201,
    body: {
      username: 'test_user',
      email: 'user@example.test',
      password: 'valid-password',
    },
  },
  {
    path: 'reset-password',
    limit: 5,
    status: 200,
    body: { token: 'a'.repeat(64), password: 'valid-password' },
  },
  { path: 'refresh', limit: 10, status: 200 },
];

describe('Auth throttling (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(throttledRoutes)(
    'returns 429 for POST /auth/$path after $limit requests',
    async ({ path, limit, status, body }) => {
      const makeRequest = () => {
        const testRequest = request(app.getHttpServer()).post(`/auth/${path}`);
        return body ? testRequest.send(body) : testRequest;
      };

      for (let attempt = 0; attempt < limit; attempt += 1) {
        await makeRequest().expect(status);
      }
      await makeRequest().expect(429);
    },
  );

  it('does not throttle unrelated public auth routes', async () => {
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/verify-email')
        .send({ token: 'a'.repeat(64) })
        .expect(200);
    }
  });
});
