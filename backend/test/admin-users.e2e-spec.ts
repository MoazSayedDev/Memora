import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AdminUsersController } from '../src/modules/admin/admin-users.controller';
import { AdminUsersService } from '../src/modules/admin/admin-users.service';

jest.mock('../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

const adminId = '550e8400-e29b-41d4-a716-446655440000';
const regularUserId = '550e8400-e29b-41d4-a716-446655440001';

@Injectable()
class AdminTestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: { id: string };
    }>();
    if (request.headers.authorization === 'Bearer admin-token') {
      request.user = { id: adminId };
      return true;
    }
    if (request.headers.authorization === 'Bearer user-token') {
      request.user = { id: regularUserId };
      return true;
    }
    throw new UnauthorizedException();
  }
}

describe('Admin users endpoint (e2e)', () => {
  let app: INestApplication<App>;
  const service = {
    listUsers: jest.fn((userId: string) => {
      if (userId !== adminId) {
        return Promise.reject(new ForbiddenException());
      }
      return Promise.resolve([
        {
          id: adminId,
          name: 'Memora',
          username: 'memora_admin',
          email: 'memora@memora.com',
          isEmailVerified: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AdminUsersController],
      providers: [
        { provide: AdminUsersService, useValue: service },
        { provide: APP_GUARD, useClass: AdminTestGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/admin/users').expect(401);
  });

  it('returns the users list to the admin account only', async () => {
    await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', 'Bearer admin-token')
      .expect(200)
      .expect((response) => {
        const body: unknown = response.body;
        expect(body).toHaveProperty('[0].email', 'memora@memora.com');
        expect(body).not.toHaveProperty('[0].passwordHash');
      });
    expect(service.listUsers).toHaveBeenCalledWith(adminId);

    await request(app.getHttpServer())
      .get('/admin/users')
      .set('Authorization', 'Bearer user-token')
      .expect(403);
    expect(service.listUsers).toHaveBeenCalledWith(regularUserId);
  });
});
