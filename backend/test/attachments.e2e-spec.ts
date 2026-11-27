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
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import request from 'supertest';
import { App } from 'supertest/types';
import { AttachmentUploadGuard } from '../src/modules/attachments/attachment-upload.guard';
import { AttachmentsController } from '../src/modules/attachments/attachments.controller';
import { AttachmentsService } from '../src/modules/attachments/attachments.service';

jest.mock('@nestjs/config', () => ({
  ConfigService: class {},
}));
jest.mock('../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

@Injectable()
class AttachmentsTestGuard implements CanActivate {
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

describe('Attachments endpoints (e2e)', () => {
  let app: INestApplication<App>;
  const service = {
    assertCanUpload: jest.fn().mockResolvedValue(undefined),
    upload: jest.fn().mockResolvedValue([{ id: 'attachment-id' }]),
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: 'attachment-id' }),
    getDownload: jest.fn(),
    remove: jest.fn().mockResolvedValue({ id: 'attachment-id', deleted: true }),
  };
  const entryId = '550e8400-e29b-41d4-a716-446655440001';
  const attachmentId = '550e8400-e29b-41d4-a716-446655440002';

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MulterModule.register({ storage: memoryStorage() })],
      controllers: [AttachmentsController],
      providers: [
        Reflector,
        { provide: AttachmentsService, useValue: service },
        AttachmentUploadGuard,
        { provide: APP_GUARD, useClass: AttachmentsTestGuard },
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

  it('requires authentication for attachment routes', async () => {
    await request(app.getHttpServer())
      .get(`/attachments/${attachmentId}`)
      .expect(401);
  });

  it('uploads multipart files for the authenticated member', async () => {
    await request(app.getHttpServer())
      .post(`/entries/${entryId}/attachments`)
      .set('Authorization', 'Bearer valid-access-token')
      .attach('files', Buffer.from([0xff, 0xd8, 0xff]), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(service.upload).toHaveBeenCalledWith(
      entryId,
      '550e8400-e29b-41d4-a716-446655440000',
      expect.arrayContaining([
        expect.objectContaining({ originalname: 'photo.jpg' }),
      ]),
    );
    expect(service.assertCanUpload).toHaveBeenCalledWith(
      entryId,
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('lists and retrieves attachment metadata', async () => {
    await request(app.getHttpServer())
      .get(`/entries/${entryId}/attachments`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
    await request(app.getHttpServer())
      .get(`/attachments/${attachmentId}`)
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200);
  });
});
