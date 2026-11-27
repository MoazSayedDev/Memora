import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { PrismaModule } from '../../prisma/prisma.module';
import { ATTACHMENT_STORAGE } from './attachment-storage.interface';
import { AttachmentUploadGuard } from './attachment-upload.guard';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import {
  getAttachmentFilePolicy,
  MAX_FILES_PER_UPLOAD,
} from './file-validation';
import { LocalAttachmentStorageService } from './local-attachment-storage.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uploadDirectory = resolve(
          process.cwd(),
          configService.get<string>('UPLOADS_DIR') ?? 'uploads',
        );
        const maximumSizeMb = Math.max(
          configService.getOrThrow<number>('MAX_ATTACHMENT_IMAGE_SIZE_MB'),
          configService.getOrThrow<number>('MAX_ATTACHMENT_VIDEO_SIZE_MB'),
          configService.getOrThrow<number>('MAX_ATTACHMENT_DOCUMENT_SIZE_MB'),
          configService.getOrThrow<number>('MAX_ATTACHMENT_AUDIO_SIZE_MB'),
        );
        return {
          storage: diskStorage({
            destination: (_request, _file, callback) => {
              const temporaryDirectory = join(uploadDirectory, '.tmp');
              void mkdir(temporaryDirectory, { recursive: true })
                .then(() => callback(null, temporaryDirectory))
                .catch((error: Error) => callback(error, temporaryDirectory));
            },
            filename: (_request, file, callback) => {
              callback(
                null,
                `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
              );
            },
          }),
          fileFilter: (_request, file, callback) => {
            try {
              getAttachmentFilePolicy(file.originalname, file.mimetype);
              callback(null, true);
            } catch (error) {
              callback(
                error instanceof Error
                  ? error
                  : new Error('Unsupported attachment'),
                false,
              );
            }
          },
          limits: {
            fileSize: maximumSizeMb * 1024 * 1024,
            files: MAX_FILES_PER_UPLOAD,
          },
        };
      },
    }),
  ],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    AttachmentUploadGuard,
    LocalAttachmentStorageService,
    {
      provide: ATTACHMENT_STORAGE,
      useExisting: LocalAttachmentStorageService,
    },
  ],
  exports: [ATTACHMENT_STORAGE],
})
export class AttachmentsModule {}
