import { NotFoundException } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
jest.mock('@nestjs/config', () => ({
  ConfigService: class {},
}));
jest.mock('../../../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { AttachmentsService } from '../../../src/modules/attachments/attachments.service';

describe('AttachmentsService', () => {
  const attachmentId = '550e8400-e29b-41d4-a716-446655440003';
  const entryId = '550e8400-e29b-41d4-a716-446655440004';
  const ownerId = '550e8400-e29b-41d4-a716-446655440000';
  const authorId = '550e8400-e29b-41d4-a716-446655440001';
  const otherMemberId = '550e8400-e29b-41d4-a716-446655440002';
  let temporaryDirectory: string;
  const attachment = {
    id: attachmentId,
    entryId,
    uploadedById: authorId,
    originalName: 'photo.jpg',
    type: 'IMAGE',
    fileUrl: 'private-storage-key.jpg',
    mimeType: 'image/jpeg',
    fileSize: 4,
    duration: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    entry: {
      capsuleMember: {
        userId: authorId,
        capsule: {
          id: '550e8400-e29b-41d4-a716-446655440005',
          ownerId,
          status: 'OPEN',
        },
      },
    },
  };
  let prisma: any;
  let configService: any;
  let storage: any;
  let service: AttachmentsService;

  beforeEach(async () => {
    prisma = {
      entryAttachment: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(attachment),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      capsuleEntry: { findUnique: jest.fn() },
      capsuleMember: {
        findUnique: jest.fn().mockResolvedValue({ id: 'member' }),
      },
      $transaction: jest.fn(),
    };
    configService = { getOrThrow: jest.fn().mockReturnValue(10) };
    storage = {
      openReadStream: jest.fn(),
      delete: jest.fn().mockResolvedValue(true),
      storeTempFile: jest.fn(),
      deleteTempFile: jest.fn(),
      stageDelete: jest
        .fn()
        .mockResolvedValue('6f3158a6-6620-4ed1-95c2-7b6ac0f338a2'),
      restoreStagedFile: jest.fn(),
      finalizeStagedDelete: jest.fn(),
    };
    service = new AttachmentsService(prisma, configService, storage);
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'memora-attachment-test-'),
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('returns safe metadata without exposing the storage key', async () => {
    await expect(service.findOne(attachmentId, otherMemberId)).resolves.toEqual(
      {
        id: attachmentId,
        entryId,
        originalName: 'photo.jpg',
        mimeType: 'image/jpeg',
        fileSize: 4,
        type: 'IMAGE',
        createdAt: attachment.createdAt,
        downloadUrl: `/attachments/${attachmentId}/download`,
      },
    );
  });

  it('hides another member’s attachment until the capsule opens', async () => {
    prisma.entryAttachment.findUnique.mockResolvedValue({
      ...attachment,
      entry: {
        capsuleMember: {
          ...attachment.entry.capsuleMember,
          capsule: {
            ...attachment.entry.capsuleMember.capsule,
            status: 'CLOSED',
          },
        },
      },
    });

    await expect(
      service.findOne(attachmentId, otherMemberId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows the capsule owner to delete another member’s attachment', async () => {
    prisma.entryAttachment.findUnique.mockResolvedValue({
      ...attachment,
      entry: {
        capsuleMember: {
          ...attachment.entry.capsuleMember,
          capsule: {
            ...attachment.entry.capsuleMember.capsule,
            status: 'COLLECTING',
          },
        },
      },
    });

    await expect(service.remove(attachmentId, ownerId)).resolves.toEqual({
      id: attachmentId,
      deleted: true,
    });
    expect(storage.stageDelete).toHaveBeenCalledWith('private-storage-key.jpg');
    expect(prisma.entryAttachment.deleteMany).toHaveBeenCalledWith({
      where: { id: attachmentId },
    });
    expect(storage.finalizeStagedDelete).toHaveBeenCalledWith(
      '6f3158a6-6620-4ed1-95c2-7b6ac0f338a2',
    );
  });

  it('stores a valid image and persists safe attachment metadata', async () => {
    const filePath = join(temporaryDirectory, 'upload.tmp');
    await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0x00]));
    prisma.capsuleEntry.findUnique.mockResolvedValue({
      id: entryId,
      capsuleMember: {
        userId: authorId,
        capsule: {
          id: attachment.entry.capsuleMember.capsule.id,
          ownerId,
          status: 'COLLECTING',
          members: [{ id: 'author-member' }],
        },
      },
    });
    const createdAttachment = {
      ...attachment,
      originalName: 'photo.jpg',
      entry: {
        capsuleMember: {
          userId: authorId,
          capsule: {
            ...attachment.entry.capsuleMember.capsule,
            status: 'COLLECTING',
          },
        },
      },
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: any) => Promise<unknown>) =>
        callback({
          entryAttachment: {
            create: jest.fn().mockResolvedValue(createdAttachment),
          },
        }),
    );

    await expect(
      service.upload(entryId, authorId, [
        {
          path: filePath,
          filename: 'random.jpg',
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 4,
        } as Express.Multer.File,
      ]),
    ).resolves.toMatchObject([
      {
        originalName: 'photo.jpg',
        type: 'IMAGE',
        downloadUrl: `/attachments/${attachmentId}/download`,
      },
    ]);

    expect(storage.storeTempFile).toHaveBeenCalledWith(
      filePath,
      expect.stringMatching(/^[0-9a-f-]{36}\.jpg$/),
    );
    expect(storage.deleteTempFile).toHaveBeenCalledWith(filePath);
  });

  it('does not allow uploading to another member’s entry before the capsule opens', async () => {
    const filePath = join(temporaryDirectory, 'upload.tmp');
    await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff]));
    prisma.capsuleEntry.findUnique.mockResolvedValue({
      id: entryId,
      capsuleMember: {
        userId: authorId,
        capsule: {
          id: attachment.entry.capsuleMember.capsule.id,
          ownerId,
          status: 'COLLECTING',
          members: [{ id: 'other-member' }],
        },
      },
    });

    await expect(
      service.upload(entryId, otherMemberId, [
        {
          path: filePath,
          filename: 'random.jpg',
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 3,
        } as Express.Multer.File,
      ]),
    ).rejects.toThrow('Attachments can only be uploaded to your own entries');
    expect(storage.storeTempFile).not.toHaveBeenCalled();
    expect(storage.deleteTempFile).toHaveBeenCalledWith(filePath);
  });

  it('rejects attachments larger than the configured type limit', async () => {
    const filePath = join(temporaryDirectory, 'oversized.tmp');
    await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff]));
    prisma.capsuleEntry.findUnique.mockResolvedValue({
      id: entryId,
      capsuleMember: {
        userId: authorId,
        capsule: {
          id: attachment.entry.capsuleMember.capsule.id,
          ownerId,
          status: 'COLLECTING',
          members: [{ id: 'author-member' }],
        },
      },
    });

    await expect(
      service.upload(entryId, authorId, [
        {
          path: filePath,
          filename: 'large.jpg',
          originalname: 'large.jpg',
          mimetype: 'image/jpeg',
          size: 10 * 1024 * 1024 + 1,
        } as Express.Multer.File,
      ]),
    ).rejects.toThrow('Attachment exceeds the 10 MB limit');
    expect(storage.storeTempFile).not.toHaveBeenCalled();
    expect(storage.deleteTempFile).toHaveBeenCalledWith(filePath);
  });

  it('restores a staged file if deleting attachment metadata fails', async () => {
    prisma.entryAttachment.deleteMany.mockRejectedValue(
      new Error('database unavailable'),
    );
    prisma.entryAttachment.findUnique.mockResolvedValue({
      ...attachment,
      entry: {
        capsuleMember: {
          ...attachment.entry.capsuleMember,
          capsule: {
            ...attachment.entry.capsuleMember.capsule,
            status: 'COLLECTING',
          },
        },
      },
    });

    await expect(service.remove(attachmentId, ownerId)).rejects.toThrow(
      'database unavailable',
    );

    expect(storage.restoreStagedFile).toHaveBeenCalledWith(
      'private-storage-key.jpg',
      '6f3158a6-6620-4ed1-95c2-7b6ac0f338a2',
    );
    expect(storage.finalizeStagedDelete).not.toHaveBeenCalled();
  });

  it('removes metadata when the physical attachment file is already missing', async () => {
    storage.stageDelete.mockResolvedValue(null);
    prisma.entryAttachment.findUnique.mockResolvedValue({
      ...attachment,
      entry: {
        capsuleMember: {
          ...attachment.entry.capsuleMember,
          capsule: {
            ...attachment.entry.capsuleMember.capsule,
            status: 'COLLECTING',
          },
        },
      },
    });

    await expect(service.remove(attachmentId, ownerId)).resolves.toEqual({
      id: attachmentId,
      deleted: true,
    });

    expect(prisma.entryAttachment.deleteMany).toHaveBeenCalledWith({
      where: { id: attachmentId },
    });
  });

  it('keeps metadata when staging physical file deletion fails', async () => {
    storage.stageDelete.mockRejectedValue(new Error('storage unavailable'));
    prisma.entryAttachment.findUnique.mockResolvedValue({
      ...attachment,
      entry: {
        capsuleMember: {
          ...attachment.entry.capsuleMember,
          capsule: {
            ...attachment.entry.capsuleMember.capsule,
            status: 'COLLECTING',
          },
        },
      },
    });

    await expect(service.remove(attachmentId, ownerId)).rejects.toThrow(
      'storage unavailable',
    );

    expect(prisma.entryAttachment.deleteMany).not.toHaveBeenCalled();
  });
});
