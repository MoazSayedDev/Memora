import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CapsulesService } from '../../../src/modules/capsules/capsules.service';

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
jest.mock('../../../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

describe('CapsulesService', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000';
  const capsuleId = '550e8400-e29b-41d4-a716-446655440001';
  let prisma: any;
  let service: CapsulesService;

  const capsule = {
    id: capsuleId,
    ownerId: userId,
    name: 'Summer',
    description: null,
    cover: null,
    type: 'PERSONAL',
    opensAt: new Date('2030-01-01T00:00:00.000Z'),
    status: 'DRAFT',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      capsule: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      capsuleMember: {
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      invitationLink: { deleteMany: jest.fn() },
      $transaction: jest.fn(),
    };
    service = new CapsulesService(prisma);
  });

  it('creates a personal capsule and owner membership', async () => {
    prisma.capsule.create.mockResolvedValue(capsule);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await expect(
      service.create(userId, {
        title: 'Summer',
        type: 'PERSONAL' as any,
        openingDate: '2030-01-01T00:00:00.000Z',
      }),
    ).resolves.toHaveProperty('ownerId', userId);
    expect(prisma.capsuleMember.create).toHaveBeenCalledWith({
      data: { capsuleId, userId, role: 'OWNER' },
    });
  });

  it('creates a group capsule in COLLECTING status', async () => {
    prisma.capsule.create.mockResolvedValue({
      ...capsule,
      type: 'GROUP',
      status: 'COLLECTING',
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await expect(
      service.create(userId, {
        title: 'Group',
        type: 'GROUP' as any,
      }),
    ).resolves.toHaveProperty('status', 'COLLECTING');
  });

  it('starts a scheduled personal capsule in COLLECTING status', async () => {
    const closeAt = new Date(Date.now() + 60_000).toISOString();
    const openAt = new Date(Date.now() + 120_000).toISOString();
    prisma.capsule.create.mockResolvedValue({
      ...capsule,
      status: 'COLLECTING',
      closeAt: new Date(closeAt),
    });
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await service.create(userId, {
      title: 'Scheduled',
      type: 'PERSONAL' as any,
      closeAt,
      openAt,
    });

    expect(prisma.capsule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          closeAt: new Date(closeAt),
          opensAt: new Date(openAt),
          status: 'COLLECTING',
        }),
      }),
    );
  });

  it('rejects a closing date that is not before the opening date', async () => {
    const openAt = new Date(Date.now() + 60_000).toISOString();
    const closeAt = new Date(Date.now() + 120_000).toISOString();

    await expect(
      service.create(userId, {
        title: 'Invalid schedule',
        type: 'GROUP' as any,
        closeAt,
        openAt,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a past opening date', async () => {
    await expect(
      service.create(userId, {
        title: 'Past',
        type: 'PERSONAL' as any,
        openingDate: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists accessible capsules with pagination', async () => {
    prisma.$transaction.mockResolvedValue([[capsule], 1]);

    await expect(
      service.findMine(userId, { page: 1, limit: 20 }),
    ).resolves.toMatchObject({
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  });

  it('prevents access to an inaccessible capsule', async () => {
    prisma.capsule.findFirst.mockResolvedValue(null);
    await expect(service.findOne(userId, capsuleId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('prevents updating another owner capsule', async () => {
    prisma.capsule.findFirst.mockResolvedValue(null);
    await expect(
      service.update(userId, capsuleId, { title: 'Changed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('prevents updates to OPEN and CANCELLED capsules', async () => {
    prisma.capsule.findFirst.mockResolvedValue({ ...capsule, status: 'OPEN' });
    await expect(
      service.update(userId, capsuleId, { title: 'Changed' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.capsule.findFirst.mockResolvedValue({
      ...capsule,
      status: 'CANCELLED',
    });
    await expect(
      service.update(userId, capsuleId, { title: 'Changed' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancels only eligible capsules', async () => {
    prisma.capsule.findFirst
      .mockResolvedValueOnce({ ...capsule, status: 'DRAFT' })
      .mockResolvedValueOnce(capsule);
    prisma.capsule.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.cancel(userId, capsuleId)).resolves.toHaveProperty(
      'status',
      'DRAFT',
    );
  });

  it('prevents cancelling an OPEN capsule', async () => {
    prisma.capsule.findFirst.mockResolvedValue({ ...capsule, status: 'OPEN' });
    await expect(service.cancel(userId, capsuleId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resets status to COLLECTING when updating to GROUP', async () => {
    prisma.capsule.findFirst
      .mockResolvedValueOnce({ ...capsule, status: 'DRAFT' })
      .mockResolvedValueOnce({
        ...capsule,
        type: 'GROUP',
        status: 'COLLECTING',
      });
    prisma.capsule.updateMany.mockResolvedValue({ count: 1 });

    await service.update(userId, capsuleId, { type: 'GROUP' as any });

    expect(prisma.capsule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { type: 'GROUP', status: 'COLLECTING' },
      }),
    );
  });

  it('does not move a collecting capsule back to DRAFT when changing to PERSONAL', async () => {
    prisma.capsule.findFirst
      .mockResolvedValueOnce({ ...capsule, status: 'COLLECTING' })
      .mockResolvedValueOnce({ ...capsule, type: 'PERSONAL', status: 'DRAFT' });
    prisma.capsule.updateMany.mockResolvedValue({ count: 1 });

    await service.update(userId, capsuleId, { type: 'PERSONAL' as any });

    expect(prisma.capsule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { type: 'PERSONAL' },
      }),
    );
  });

  it('leaves status unchanged when updating without a type change', async () => {
    prisma.capsule.findFirst
      .mockResolvedValueOnce({ ...capsule, status: 'COLLECTING' })
      .mockResolvedValueOnce({ ...capsule, status: 'COLLECTING' });
    prisma.capsule.updateMany.mockResolvedValue({ count: 1 });

    await service.update(userId, capsuleId, { title: 'Changed' });

    expect(prisma.capsule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Changed' } }),
    );
  });

  it('is idempotent for repeated cancellation', async () => {
    prisma.capsule.findFirst
      .mockResolvedValueOnce({ ...capsule, status: 'CANCELLED' })
      .mockResolvedValueOnce({ ...capsule, status: 'CANCELLED' });
    await expect(service.cancel(userId, capsuleId)).resolves.toHaveProperty(
      'status',
      'CANCELLED',
    );
  });

  it('does not permanently delete an opened capsule', async () => {
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );
    prisma.capsule.findFirst.mockResolvedValue({
      id: capsuleId,
      status: 'OPEN',
      members: [],
      invitations: [],
    });
    await expect(service.remove(userId, capsuleId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
