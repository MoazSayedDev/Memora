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
import { CapsulesController } from '../src/modules/capsules/capsules.controller';
import { CapsulesService } from '../src/modules/capsules/capsules.service';
import { CapsuleLifecycleService } from '../src/modules/capsules/capsule-lifecycle.service';

jest.mock('@prisma/client', () => ({
  CapsuleType: { PERSONAL: 'PERSONAL', GROUP: 'GROUP' },
  CapsuleStatus: {
    DRAFT: 'DRAFT',
    COLLECTING: 'COLLECTING',
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    CANCELLED: 'CANCELLED',
  },
}));
jest.mock('../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

@Injectable()
class CapsulesTestGuard implements CanActivate {
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

describe('Capsules endpoints (e2e)', () => {
  let app: INestApplication<App>;
  const service = {
    create: jest.fn().mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440001',
      ownerId: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Summer',
      status: 'DRAFT',
    }),
    findMine: jest.fn().mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    }),
    findOne: jest.fn().mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440001',
      title: 'Summer',
    }),
    update: jest.fn().mockResolvedValue({ title: 'Updated' }),
    cancel: jest.fn().mockResolvedValue({ status: 'CANCELLED' }),
    remove: jest.fn().mockResolvedValue({
      message: 'Capsule deleted successfully',
    }),
  };
  const lifecycleService = {
    updateSchedule: jest.fn().mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440001',
      status: 'COLLECTING',
    }),
    closeNow: jest.fn().mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440001',
      status: 'CLOSED',
    }),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CapsulesController],
      providers: [
        Reflector,
        { provide: CapsulesService, useValue: service },
        { provide: CapsuleLifecycleService, useValue: lifecycleService },
        { provide: APP_GUARD, useClass: CapsulesTestGuard },
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

  it('rejects missing authentication', async () => {
    await request(app.getHttpServer()).post('/capsules').send({}).expect(401);
  });

  it('creates a personal capsule', async () => {
    await request(app.getHttpServer())
      .post('/capsules')
      .set('Authorization', 'Bearer valid-access-token')
      .send({ title: 'Summer', type: 'PERSONAL' })
      .expect(201);
  });

  it('rejects ownerId mass assignment', async () => {
    await request(app.getHttpServer())
      .post('/capsules')
      .set('Authorization', 'Bearer valid-access-token')
      .send({
        title: 'Summer',
        type: 'PERSONAL',
        ownerId: '550e8400-e29b-41d4-a716-446655440099',
      })
      .expect(400);
  });

  it('rejects invalid capsule type', async () => {
    await request(app.getHttpServer())
      .post('/capsules')
      .set('Authorization', 'Bearer valid-access-token')
      .send({ title: 'Summer', type: 'INVALID' })
      .expect(400);
  });

  it('lists my capsules', async () => {
    await request(app.getHttpServer())
      .get('/capsules?page=1&limit=20')
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
  });

  it('gets capsule metadata by ID', async () => {
    await request(app.getHttpServer())
      .get('/capsules/550e8400-e29b-41d4-a716-446655440001')
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toHaveProperty('entries');
        expect(body).not.toHaveProperty('attachments');
      });
  });

  it('updates an owned capsule', async () => {
    await request(app.getHttpServer())
      .patch('/capsules/550e8400-e29b-41d4-a716-446655440001')
      .set('Authorization', 'Bearer valid-access-token')
      .send({ title: 'Updated' })
      .expect(200);
  });

  it('updates the schedule and closes a capsule through lifecycle endpoints', async () => {
    const closeAt = new Date(Date.now() + 60_000).toISOString();
    const openAt = new Date(Date.now() + 120_000).toISOString();
    await request(app.getHttpServer())
      .patch('/capsules/550e8400-e29b-41d4-a716-446655440001/schedule')
      .set('Authorization', 'Bearer valid-access-token')
      .send({ closeAt, openAt })
      .expect(200);
    expect(lifecycleService.updateSchedule).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440001',
      { closeAt, openAt },
    );

    await request(app.getHttpServer())
      .post('/capsules/550e8400-e29b-41d4-a716-446655440001/close')
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
    expect(lifecycleService.closeNow).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      '550e8400-e29b-41d4-a716-446655440001',
    );
  });

  it('rejects protected fields', async () => {
    await request(app.getHttpServer())
      .patch('/capsules/550e8400-e29b-41d4-a716-446655440001')
      .set('Authorization', 'Bearer valid-access-token')
      .send({ status: 'OPEN' })
      .expect(400);
  });

  it('cancels and deletes capsules', async () => {
    await request(app.getHttpServer())
      .patch('/capsules/550e8400-e29b-41d4-a716-446655440001/cancel')
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);

    await request(app.getHttpServer())
      .delete('/capsules/550e8400-e29b-41d4-a716-446655440001')
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
  });
});
