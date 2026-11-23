import { Test, TestingModule } from '@nestjs/testing';
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { Public } from '../src/common/decorators/public.decorator';

@Injectable()
class TestJwtGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const authorization =
      context.switchToHttp().getRequest().headers.authorization;
    if (authorization !== 'Bearer valid-access-token') {
      throw new UnauthorizedException();
    }
    return true;
  }
}

@Controller()
class TestAuthorizationController {
  @Get()
  @Public()
  publicRoot() {
    return 'public';
  }

  @Get('protected')
  protectedResource() {
    return 'protected';
  }
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TestAuthorizationController],
      providers: [
        Reflector,
        {
          provide: APP_GUARD,
          useClass: TestJwtGuard,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET) allows the public route', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('public');
  });

  it('/protected (GET) rejects a missing access token', () => {
    return request(app.getHttpServer()).get('/protected').expect(401);
  });

  it('/protected (GET) rejects an invalid access token', () => {
    return request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', 'Bearer invalid-access-token')
      .expect(401);
  });

  it('/protected (GET) accepts a valid access token', () => {
    return request(app.getHttpServer())
      .get('/protected')
      .set('Authorization', 'Bearer valid-access-token')
      .expect(200)
      .expect('protected');
  });
});
