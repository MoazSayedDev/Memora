import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { UsersController } from '../src/modules/users/users.controller';
import { UsersService } from '../src/modules/users/users.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
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
  compare: jest.fn(),
  hash: jest.fn(),
}));
jest.mock('../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

@Injectable()
class UsersTestGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: { id: string };
    }>();
    if (request.headers.authorization !== 'Bearer valid-access-token') {
      throw new UnauthorizedException();
    }
    request.user = { id: '550e8400-e29b-41d4-a716-446655440000' };
    return true;
  }
}

describe('Users endpoints (e2e)', () => {
  let app: INestApplication<App>;

  const usersService = {
    getCurrentProfile: jest.fn().mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      username: 'memora_user',
      name: 'Memora User',
      email: 'user@memora.test',
      isEmailVerified: true,
    }),
    getPublicProfile: jest.fn().mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440001',
      username: 'public_user',
      name: 'Public User',
    }),
    updateProfile: jest.fn().mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      username: 'memora_user',
      name: 'Updated Name',
      email: 'user@memora.test',
      isEmailVerified: true,
    }),
    changePassword: jest.fn().mockResolvedValue({
      message: 'Password changed successfully',
    }),
    deleteAccount: jest.fn().mockResolvedValue({
      message: 'Account deleted successfully',
    }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        Reflector,
        { provide: UsersService, useValue: usersService },
        { provide: APP_GUARD, useClass: UsersTestGuard },
      ],
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

  it('GET /users/me rejects missing authentication', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('GET /users/me returns the current profile', async () => {
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toHaveProperty('passwordHash');
      });
  });

  it('GET /users/:id returns a public profile', async () => {
    await request(app.getHttpServer())
      .get('/users/550e8400-e29b-41d4-a716-446655440001')
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toHaveProperty('email');
        expect(body).not.toHaveProperty('passwordHash');
      });
  });

  it('PATCH /users/me updates the current profile', async () => {
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', 'Bearer valid-access-token')
      .send({ name: 'Updated Name' })
      .expect(200);
  });

  it('PATCH /users/me rejects protected fields', async () => {
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', 'Bearer valid-access-token')
      .send({ email: 'changed@memora.test' })
      .expect(400);
  });

  it('PATCH /users/me/password changes the password', async () => {
    await request(app.getHttpServer())
      .patch('/users/me/password')
      .set('Authorization', 'Bearer valid-access-token')
      .send({
        currentPassword: 'password123',
        newPassword: 'new-password123',
      })
      .expect(200);
  });

  it('DELETE /users/me deletes the account', async () => {
    await request(app.getHttpServer())
      .delete('/users/me')
      .set('Authorization', 'Bearer valid-access-token')
      .send({ password: 'password123' })
      .expect(200);
  });
});
