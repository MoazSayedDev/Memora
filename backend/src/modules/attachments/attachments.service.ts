import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AttachmentType, CapsuleStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCapsuleAcceptsContent } from '../capsules/capsule-lifecycle.policy';
import {
  assertFileSignature,
  getAttachmentFilePolicy,
} from './file-validation';
import { ATTACHMENT_STORAGE } from './attachment-storage.interface';
import type { AttachmentStorage } from './attachment-storage.interface';

const attachmentSelect = {
  id: true,
  entryId: true,
  uploadedById: true,
  originalName: true,
  type: true,
  fileUrl: true,
  mimeType: true,
  fileSize: true,
  duration: true,
  createdAt: true,
  entry: {
    select: {
      capsuleMember: {
        select: {
          userId: true,
          capsule: {
            select: {
              id: true,
              ownerId: true,
              status: true,
            },
          },
        },
      },
    },
  },
} as const;

type AttachmentRecord = Prisma.EntryAttachmentGetPayload<{
  select: typeof attachmentSelect;
}>;

const MAX_SIZE_ENV: Record<AttachmentType, string> = {
  IMAGE: 'MAX_ATTACHMENT_IMAGE_SIZE_MB',
  VIDEO: 'MAX_ATTACHMENT_VIDEO_SIZE_MB',
  DOCUMENT: 'MAX_ATTACHMENT_DOCUMENT_SIZE_MB',
  AUDIO: 'MAX_ATTACHMENT_AUDIO_SIZE_MB',
};

type PreparedAttachment = {
  file: Express.Multer.File;
  policy: ReturnType<typeof getAttachmentFilePolicy>;
  storageKey: string;
  originalName: string;
};

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: AttachmentStorage,
  ) {}

  async upload(entryId: string, userId: string, files: Express.Multer.File[]) {
    if (!files.length) {
      throw new BadRequestException('At least one attachment is required');
    }

    const storedKeys: string[] = [];
    try {
      const entry = await this.findAccessibleEntry(entryId, userId, true);
      assertCapsuleAcceptsContent(entry.capsule.status);

      const prepared: PreparedAttachment[] = [];
      for (const file of files) {
        const policy = getAttachmentFilePolicy(
          file.originalname,
          file.mimetype,
        );
        const maxSizeMb = this.configService.getOrThrow<number>(
          MAX_SIZE_ENV[policy.type],
        );
        if (file.size > maxSizeMb * 1024 * 1024) {
          throw new BadRequestException(
            `Attachment exceeds the ${maxSizeMb} MB limit`,
          );
        }
        await assertFileSignature(file.path, file.originalname);
        prepared.push({
          file,
          policy,
          storageKey: `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
          originalName: this.sanitizeOriginalName(file.originalname),
        });
      }

      for (const item of prepared) {
        await this.storage.storeTempFile(item.file.path, item.storageKey);
        storedKeys.push(item.storageKey);
      }

      const attachments = await this.prisma.$transaction(async (tx) => {
        const created: AttachmentRecord[] = [];
        for (const item of prepared) {
          created.push(
            await tx.entryAttachment.create({
              data: {
                entryId,
                uploadedById: userId,
                originalName: item.originalName,
                type: item.policy.type,
                fileUrl: item.storageKey,
                mimeType: item.file.mimetype,
                fileSize: item.file.size,
              },
              select: attachmentSelect,
            }),
          );
        }
        return created;
      });

      return attachments.map((attachment) => this.mapAttachment(attachment));
    } catch (error) {
      for (const storageKey of storedKeys) {
        try {
          await this.storage.delete(storageKey);
        } catch (cleanupError) {
          this.logger.error(
            `Failed to clean up attachment storage key ${storageKey}`,
            cleanupError instanceof Error ? cleanupError.stack : undefined,
          );
        }
      }
      throw error;
    } finally {
      for (const file of files) {
        try {
          await this.storage.deleteTempFile(file.path);
        } catch (cleanupError) {
          this.logger.error(
            `Failed to clean up temporary attachment ${file.filename}`,
            cleanupError instanceof Error ? cleanupError.stack : undefined,
          );
        }
      }
    }
  }

  async assertCanUpload(entryId: string, userId: string) {
    const entry = await this.findAccessibleEntry(entryId, userId, true);
    assertCapsuleAcceptsContent(entry.capsule.status);
  }

  async findAll(entryId: string, userId: string) {
    await this.findAccessibleEntry(entryId, userId, false);
    const attachments = await this.prisma.entryAttachment.findMany({
      where: { entryId },
      select: attachmentSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return attachments.map((attachment) => this.mapAttachment(attachment));
  }

  async findOne(attachmentId: string, userId: string) {
    const attachment = await this.findAccessibleAttachment(
      attachmentId,
      userId,
    );
    return this.mapAttachment(attachment);
  }

  async getDownload(attachmentId: string, userId: string) {
    const attachment = await this.findAccessibleAttachment(
      attachmentId,
      userId,
    );
    let stream;
    try {
      stream = await this.storage.openReadStream(attachment.fileUrl);
    } catch (error) {
      if (this.getErrorCode(error) === 'ENOENT') {
        this.logger.warn(`Attachment file is missing for ${attachment.id}`);
        throw new NotFoundException('Attachment file not found');
      }
      throw error;
    }
    return {
      attachment: this.mapAttachment(attachment),
      stream,
    };
  }

  async remove(attachmentId: string, userId: string) {
    const attachment = await this.findAccessibleAttachment(
      attachmentId,
      userId,
      true,
    );
    const capsule = attachment.entry.capsuleMember.capsule;
    if (attachment.uploadedById !== userId && capsule.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the attachment uploader or capsule owner can delete it',
      );
    }
    assertCapsuleAcceptsContent(capsule.status);

    const stagingToken = await this.storage.stageDelete(attachment.fileUrl);
    if (!stagingToken) {
      this.logger.warn(
        `Attachment file is missing for metadata ${attachment.id}; removing metadata`,
      );
    }

    let result: { count: number };
    try {
      result = await this.prisma.entryAttachment.deleteMany({
        where: { id: attachmentId },
      });
    } catch (error) {
      if (stagingToken) {
        try {
          await this.storage.restoreStagedFile(
            attachment.fileUrl,
            stagingToken,
          );
        } catch (restoreError) {
          this.logger.error(
            `Failed to restore attachment ${attachment.id} after database deletion failed`,
            restoreError instanceof Error ? restoreError.stack : undefined,
          );
        }
      }
      throw error;
    }
    if (result.count === 0) {
      if (stagingToken) {
        await this.storage.restoreStagedFile(attachment.fileUrl, stagingToken);
      }
      throw new ConflictException('Attachment changed; refresh and try again');
    }
    if (stagingToken) {
      try {
        await this.storage.finalizeStagedDelete(stagingToken);
      } catch (error) {
        this.logger.error(
          `Failed to remove staged file for attachment ${attachment.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return { id: attachmentId, deleted: true };
  }

  private async findAccessibleEntry(
    entryId: string,
    userId: string,
    writable: boolean,
  ) {
    const entry = await this.prisma.capsuleEntry.findUnique({
      where: { id: entryId },
      select: {
        id: true,
        capsuleMember: {
          select: {
            userId: true,
            capsule: {
              select: {
                id: true,
                ownerId: true,
                status: true,
                members: {
                  where: { userId },
                  select: { id: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (
      !entry ||
      (entry.capsuleMember.capsule.ownerId !== userId &&
        entry.capsuleMember.capsule.members.length === 0)
    ) {
      throw new NotFoundException('Entry not found');
    }
    if (
      !writable &&
      entry.capsuleMember.capsule.status !== CapsuleStatus.OPEN &&
      entry.capsuleMember.userId !== userId
    ) {
      throw new NotFoundException('Entry not found');
    }
    if (writable && entry.capsuleMember.userId !== userId) {
      throw new ForbiddenException(
        'Attachments can only be uploaded to your own entries',
      );
    }
    return {
      id: entry.id,
      capsule: entry.capsuleMember.capsule,
    };
  }

  private async findAccessibleAttachment(
    attachmentId: string,
    userId: string,
    allowCapsuleOwner = false,
  ): Promise<AttachmentRecord> {
    const attachment = await this.prisma.entryAttachment.findUnique({
      where: { id: attachmentId },
      select: attachmentSelect,
    });
    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    const { userId: entryAuthorId, capsule } = attachment.entry.capsuleMember;
    if (capsule.ownerId !== userId) {
      const membership = await this.prisma.capsuleMember.findUnique({
        where: {
          capsuleId_userId: {
            capsuleId: capsule.id,
            userId,
          },
        },
        select: { id: true },
      });
      if (!membership) {
        throw new NotFoundException('Attachment not found');
      }
    }
    if (
      capsule.status !== CapsuleStatus.OPEN &&
      entryAuthorId !== userId &&
      !(allowCapsuleOwner && capsule.ownerId === userId)
    ) {
      throw new NotFoundException('Attachment not found');
    }
    return attachment;
  }

  private mapAttachment(attachment: AttachmentRecord) {
    return {
      id: attachment.id,
      entryId: attachment.entryId,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      type: attachment.type,
      createdAt: attachment.createdAt,
      downloadUrl: `/attachments/${attachment.id}/download`,
    };
  }

  private sanitizeOriginalName(originalName: string) {
    const filename = originalName.split(/[\\/]/).pop() ?? '';
    return filename.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
  }

  private getErrorCode(error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      return error.code;
    }
    return undefined;
  }
}
