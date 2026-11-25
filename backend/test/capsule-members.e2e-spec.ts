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
import { CapsuleMembersController } from '../src/modules/capsule-members/capsule-members.controller';
import { CapsuleMembersService } from '../src/modules/capsule-members/capsule-members.service';

jest.mock('@prisma/client', () => ({
  MemberRole: { OWNER: 'OWNER', MEMBER: 'MEMBER' },
}));
jest.mock('../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

@Injectable()
class CapsuleMembersTestGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    void this.reflector;
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

describe('Capsule members endpoints (e2e)', () => {
  let app: INestApplication<App>;
  const ownerId = '550e8400-e29b-41d4-a716-446655440000';
  const capsuleId = '550e8400-e29b-41d4-a716-446655440001';
  const memberId = '550e8400-e29b-41d4-a716-446655440002';
  const service = {
    add: jest.fn().mockResolvedValue({ userId: memberId, role: 'MEMBER' }),
    findAll: jest.fn().mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    }),
    remove: jest.fn().mockResolvedValue({ userId: memberId, removed: true }),
    updateRole: jest
      .fn()
      .mockResolvedValue({ userId: memberId, role: 'MEMBER' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CapsuleMembersController],
      providers: [
        Reflector,
        { provide: CapsuleMembersService, useValue: service },
        { provide: APP_GUARD, useClass: CapsuleMembersTestGuard },
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

  it('requires authentication and uses the authenticated owner ID', async () => {
    await request(app.getHttpServer())
      .post(`/capsules/${capsuleId}/members`)
      .send({ userId: memberId })
      .expect(401);

    await request(app.getHttpServer())
      .post(`/capsules/${capsuleId}/members`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({ userId: memberId })
      .expect(201);
    expect(service.add).toHaveBeenCalledWith(capsuleId, ownerId, memberId);
  });

  it('validates UUID inputs and rejects owner assignment in role body at service layer', async () => {
    await request(app.getHttpServer())
      .post(`/capsules/${capsuleId}/members`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({ userId: 'not-a-uuid' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/capsules/${capsuleId}/members/${memberId}/role`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({ role: 'INVALID' })
      .expect(400);
    expect(service.updateRole).not.toHaveBeenCalled();
  });

  it('exposes list, remove, and role routes using the authenticated user', async () => {
    await request(app.getHttpServer())
      .get(`/capsules/${capsuleId}/members`)
      .expect(401);

    await request(app.getHttpServer())
      .get(`/capsules/${capsuleId}/members?page=1&limit=20`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
    expect(service.findAll).toHaveBeenCalledWith(
      capsuleId,
      ownerId,
      expect.objectContaining({ page: 1, limit: 20 }),
    );

    await request(app.getHttpServer())
      .delete(`/capsules/${capsuleId}/members/${memberId}`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
    expect(service.remove).toHaveBeenCalledWith(capsuleId, ownerId, memberId);

    await request(app.getHttpServer())
      .patch(`/capsules/${capsuleId}/members/${memberId}/role`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({ role: 'MEMBER' })
      .expect(200);
    expect(service.updateRole).toHaveBeenCalledWith(
      capsuleId,
      ownerId,
      memberId,
      'MEMBER',
    );
  });
});
