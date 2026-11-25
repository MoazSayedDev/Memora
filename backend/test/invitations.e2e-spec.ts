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
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { InvitationsController } from '../src/modules/invitations/invitations.controller';
import { InvitationsService } from '../src/modules/invitations/invitations.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('@prisma/client', () => ({
  CapsuleStatus: {
    DRAFT: 'DRAFT',
    COLLECTING: 'COLLECTING',
    OPEN: 'OPEN',
    CANCELLED: 'CANCELLED',
  },
  CapsuleType: { PERSONAL: 'PERSONAL', GROUP: 'GROUP' },
  InvitationStatus: { ACTIVE: 'ACTIVE', REVOKED: 'REVOKED' },
  MemberRole: { OWNER: 'OWNER', MEMBER: 'MEMBER' },
  Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' } },
}));
jest.mock('../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

@Injectable()
class InvitationsTestGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

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

describe('Invitations endpoints (e2e)', () => {
  let app: INestApplication<App>;
  const ownerId = '550e8400-e29b-41d4-a716-446655440000';
  const capsuleId = '550e8400-e29b-41d4-a716-446655440001';
  const invitationId = '550e8400-e29b-41d4-a716-446655440002';
  const token = 'a'.repeat(43);
  const service = {
    create: jest.fn().mockResolvedValue({
      id: invitationId,
      invitationUrl: `https://memora.example/invitations/${token}`,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    }),
    findAll: jest.fn().mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    }),
    revoke: jest
      .fn()
      .mockResolvedValue({ id: invitationId, status: 'REVOKED' }),
    validate: jest.fn().mockResolvedValue({
      capsule: {
        id: capsuleId,
        title: 'Summer',
        description: null,
        openingDate: null,
        owner: { name: 'Owner', username: null },
      },
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    }),
    join: jest.fn().mockResolvedValue({
      capsule: { id: capsuleId, title: 'Summer', openingDate: null },
      membership: {
        id: '550e8400-e29b-41d4-a716-446655440003',
        role: 'MEMBER',
        joinedAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [InvitationsController],
      providers: [
        Reflector,
        { provide: InvitationsService, useValue: service },
        { provide: APP_GUARD, useClass: InvitationsTestGuard },
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

  it('allows a public read-only invitation preview without authentication', async () => {
    await request(app.getHttpServer())
      .get(`/invitations/${token}`)
      .expect(200)
      .expect((response) => {
        const body: unknown = response.body;
        expect(body).toHaveProperty('capsule.title', 'Summer');
        expect(body).not.toHaveProperty('tokenHash');
        expect(body).not.toHaveProperty('capsule.entries');
      });
    expect(service.validate).toHaveBeenCalledWith(token);
  });

  it('requires authentication to join and uses the authenticated user ID', async () => {
    await request(app.getHttpServer())
      .post(`/invitations/${token}/join`)
      .expect(401);

    await request(app.getHttpServer())
      .post(`/invitations/${token}/join`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({ userId: '550e8400-e29b-41d4-a716-446655440099' })
      .expect(201);
    expect(service.join).toHaveBeenCalledWith(token, ownerId);
  });

  it('requires authentication to create and revoke invitation links', async () => {
    await request(app.getHttpServer())
      .get(`/capsules/${capsuleId}/invitations`)
      .expect(401);

    await request(app.getHttpServer())
      .get(`/capsules/${capsuleId}/invitations?status=REVOKED&page=2&limit=10`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
    expect(service.findAll).toHaveBeenCalledWith(
      capsuleId,
      ownerId,
      expect.objectContaining({
        status: 'REVOKED',
        page: 2,
        limit: 10,
      }),
    );

    await request(app.getHttpServer())
      .get(`/capsules/${capsuleId}/invitations?status=INVALID`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(400);

    await request(app.getHttpServer())
      .post(`/capsules/${capsuleId}/invitations`)
      .expect(401);

    await request(app.getHttpServer())
      .post(`/capsules/${capsuleId}/invitations`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(201);
    expect(service.create).toHaveBeenCalledWith(capsuleId, ownerId);

    await request(app.getHttpServer())
      .delete(`/capsules/${capsuleId}/invitations/${invitationId}`)
      .expect(401);

    await request(app.getHttpServer())
      .delete(`/capsules/${capsuleId}/invitations/${invitationId}`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
    expect(service.revoke).toHaveBeenCalledWith(
      capsuleId,
      invitationId,
      ownerId,
    );
  });
});
