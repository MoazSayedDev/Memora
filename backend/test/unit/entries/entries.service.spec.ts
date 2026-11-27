import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EntriesService } from '../../../src/modules/entries/entries.service';

jest.mock('@prisma/client', () => ({
  CapsuleStatus: {
    DRAFT: 'DRAFT',
    COLLECTING: 'COLLECTING',
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    CANCELLED: 'CANCELLED',
  },
  Prisma: {
    TransactionIsolationLevel: { Serializable: 'Serializable' },
  },
}));
jest.mock('../../../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

describe('EntriesService', () => {
  const capsuleId = '550e8400-e29b-41d4-a716-446655440001';
  const authorId = '550e8400-e29b-41d4-a716-446655440000';
  const otherId = '550e8400-e29b-41d4-a716-446655440002';
  const entryId = '550e8400-e29b-41d4-a716-446655440003';
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const entry = {
    id: entryId,
    text: 'A message to remember',
    createdAt,
    updatedAt: createdAt,
    capsuleMember: {
      capsuleId,
      userId: authorId,
      user: { id: authorId, name: 'Author', username: 'author' },
    },
  };
  let prisma: any;
  let service: EntriesService;

  beforeEach(() => {
    prisma = {
      capsule: { findFirst: jest.fn() },
      capsuleEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      entryAttachment: { deleteMany: jest.fn() },
      $transaction: jest.fn((operation: unknown) =>
        Array.isArray(operation)
          ? Promise.all(operation)
          : (operation as (tx: typeof prisma) => Promise<unknown>)(prisma),
      ),
    };
    prisma.capsule.findFirst.mockResolvedValue({
      id: capsuleId,
      status: 'COLLECTING',
      members: [{ id: 'membership-id' }],
    });
    service = new EntriesService(prisma);
  });

  it('creates an entry attributed to the authenticated capsule member', async () => {
    prisma.capsuleEntry.create.mockResolvedValue(entry);

    await expect(
      service.create(capsuleId, authorId, { text: 'A message to remember' }),
    ).resolves.toMatchObject({
      id: entryId,
      capsuleId,
      author: { id: authorId, name: 'Author', username: 'author' },
    });
    expect(prisma.capsuleEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          capsuleMemberId: 'membership-id',
          text: 'A message to remember',
        },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('rejects inaccessible and restricted capsules when creating entries', async () => {
    prisma.capsule.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.create(capsuleId, otherId, { text: 'message' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    prisma.capsule.findFirst.mockResolvedValueOnce({
      id: capsuleId,
      status: 'OPEN',
      members: [{ id: 'membership-id' }],
    });
    await expect(
      service.create(capsuleId, authorId, { text: 'message' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.capsuleEntry.create).not.toHaveBeenCalled();
  });

  it('lists entries chronologically for authorized capsule members', async () => {
    prisma.capsuleEntry.findMany.mockResolvedValue([entry]);
    prisma.capsuleEntry.count.mockResolvedValue(1);

    await expect(
      service.findAll(capsuleId, authorId, { page: 1, limit: 20 }),
    ).resolves.toMatchObject({
      items: [{ id: entryId, author: { id: authorId } }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(prisma.capsuleEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          capsuleMember: { is: { capsuleId, userId: authorId } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );

    prisma.capsule.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.findAll(capsuleId, otherId, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.capsuleEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it('lists entries from all members after the capsule opens', async () => {
    prisma.capsule.findFirst.mockResolvedValueOnce({
      id: capsuleId,
      status: 'OPEN',
      members: [{ id: 'membership-id' }],
    });
    prisma.capsuleEntry.findMany.mockResolvedValue([entry]);
    prisma.capsuleEntry.count.mockResolvedValue(1);

    await service.findAll(capsuleId, otherId, { page: 1, limit: 20 });

    expect(prisma.capsuleEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capsuleMember: { is: { capsuleId } } },
      }),
    );
  });

  it('returns an entry only when it belongs to the requested capsule', async () => {
    prisma.capsuleEntry.findFirst.mockResolvedValue(entry);
    await expect(
      service.findOne(capsuleId, entryId, authorId),
    ).resolves.toHaveProperty('capsuleId', capsuleId);
    expect(prisma.capsuleEntry.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: entryId,
          capsuleMember: { is: { capsuleId, userId: authorId } },
        },
      }),
    );

    prisma.capsuleEntry.findFirst.mockResolvedValue(null);
    await expect(
      service.findOne(capsuleId, entryId, authorId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows members to read another member’s entry after the capsule opens', async () => {
    prisma.capsule.findFirst.mockResolvedValueOnce({
      id: capsuleId,
      status: 'OPEN',
      members: [{ id: 'membership-id' }],
    });
    prisma.capsuleEntry.findFirst.mockResolvedValue(entry);

    await expect(
      service.findOne(capsuleId, entryId, otherId),
    ).resolves.toHaveProperty('author.id', authorId);
    expect(prisma.capsuleEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: entryId,
          capsuleMember: { is: { capsuleId } },
        },
      }),
    );
  });

  it('updates only the author entry while its capsule remains writable', async () => {
    prisma.capsuleEntry.findFirst.mockResolvedValue({
      id: entryId,
      capsuleMemberId: 'membership-id',
      capsuleMember: { userId: authorId },
    });
    prisma.capsuleEntry.updateMany.mockResolvedValue({ count: 1 });
    prisma.capsuleEntry.findUniqueOrThrow.mockResolvedValue({
      ...entry,
      text: 'Updated',
    });

    await expect(
      service.update(capsuleId, entryId, authorId, { text: 'Updated' }),
    ).resolves.toHaveProperty('text', 'Updated');

    prisma.capsuleEntry.findFirst.mockResolvedValue({
      id: entryId,
      capsuleMemberId: 'membership-id',
      capsuleMember: { userId: authorId },
    });
    await expect(
      service.update(capsuleId, entryId, otherId, { text: 'Changed' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.capsuleEntry.updateMany).toHaveBeenCalledTimes(1);

    prisma.capsule.findFirst.mockResolvedValueOnce({
      id: capsuleId,
      status: 'CANCELLED',
      members: [{ id: 'membership-id' }],
    });
    await expect(
      service.update(capsuleId, entryId, authorId, { text: 'Changed' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes attachment records and the entry atomically for its author', async () => {
    prisma.capsuleEntry.findFirst.mockResolvedValue({
      id: entryId,
      capsuleMemberId: 'membership-id',
      capsuleMember: { userId: authorId },
    });
    prisma.capsuleEntry.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.remove(capsuleId, entryId, authorId)).resolves.toEqual(
      { id: entryId, deleted: true },
    );
    expect(prisma.entryAttachment.deleteMany).toHaveBeenCalledWith({
      where: { entryId },
    });
    expect(prisma.capsuleEntry.deleteMany).toHaveBeenCalled();
  });

  it('does not delete another author’s entry', async () => {
    prisma.capsuleEntry.findFirst.mockResolvedValue({
      id: entryId,
      capsuleMemberId: 'membership-id',
      capsuleMember: { userId: authorId },
    });

    await expect(
      service.remove(capsuleId, entryId, otherId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.entryAttachment.deleteMany).not.toHaveBeenCalled();
  });
});
