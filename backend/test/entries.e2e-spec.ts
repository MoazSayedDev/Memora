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
import { EntriesController } from '../src/modules/entries/entries.controller';
import { EntriesService } from '../src/modules/entries/entries.service';

jest.mock('@prisma/client', () => ({
  CapsuleStatus: {
    DRAFT: 'DRAFT',
    COLLECTING: 'COLLECTING',
    OPEN: 'OPEN',
    CANCELLED: 'CANCELLED',
  },
  Prisma: {
    TransactionIsolationLevel: { Serializable: 'Serializable' },
  },
}));
jest.mock('../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

@Injectable()
class EntriesTestGuard implements CanActivate {
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

describe('Entries endpoints (e2e)', () => {
  let app: INestApplication<App>;
  const service = {
    create: jest.fn().mockResolvedValue({ id: 'entry-id' }),
    findAll: jest.fn().mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    }),
    findOne: jest.fn().mockResolvedValue({ id: 'entry-id' }),
    update: jest.fn().mockResolvedValue({ id: 'entry-id' }),
    remove: jest.fn().mockResolvedValue({ id: 'entry-id', deleted: true }),
  };
  const capsuleId = '550e8400-e29b-41d4-a716-446655440001';
  const entryId = '550e8400-e29b-41d4-a716-446655440002';

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [EntriesController],
      providers: [
        Reflector,
        { provide: EntriesService, useValue: service },
        { provide: APP_GUARD, useClass: EntriesTestGuard },
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

  it('requires authentication to access entries', async () => {
    await request(app.getHttpServer())
      .get(`/capsules/${capsuleId}/entries`)
      .expect(401);
  });

  it('creates an entry with valid text', async () => {
    await request(app.getHttpServer())
      .post(`/capsules/${capsuleId}/entries`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({ text: 'A message to remember' })
      .expect(201);
    expect(service.create).toHaveBeenCalledWith(
      capsuleId,
      '550e8400-e29b-41d4-a716-446655440000',
      { text: 'A message to remember' },
    );
  });

  it('rejects blank text and protected author fields', async () => {
    await request(app.getHttpServer())
      .post(`/capsules/${capsuleId}/entries`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({ text: '   ' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/capsules/${capsuleId}/entries`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({
        text: 'Message',
        authorId: '550e8400-e29b-41d4-a716-446655440099',
      })
      .expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('lists, retrieves, updates, and deletes capsule entries', async () => {
    await request(app.getHttpServer())
      .get(`/capsules/${capsuleId}/entries?page=1&limit=20`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
    await request(app.getHttpServer())
      .get(`/capsules/${capsuleId}/entries/${entryId}`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/capsules/${capsuleId}/entries/${entryId}`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({ text: 'Updated message' })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/capsules/${capsuleId}/entries/${entryId}`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
  });

  it('rejects invalid pagination and unauthorized update fields', async () => {
    await request(app.getHttpServer())
      .get(`/capsules/${capsuleId}/entries?page=0`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/capsules/${capsuleId}/entries/${entryId}`)
      .set('Authorization', 'Bearer valid-access-token')
      .send({ text: 'Updated', capsuleId })
      .expect(400);
  });
});
