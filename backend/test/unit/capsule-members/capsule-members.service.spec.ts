import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CapsuleMembersService } from '../../../src/modules/capsule-members/capsule-members.service';

jest.mock('@prisma/client', () => ({
  CapsuleStatus: {
    DRAFT: 'DRAFT',
    COLLECTING: 'COLLECTING',
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    CANCELLED: 'CANCELLED',
  },
  CapsuleType: { PERSONAL: 'PERSONAL', GROUP: 'GROUP' },
  MemberRole: { OWNER: 'OWNER', MEMBER: 'MEMBER' },
  Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' } },
}));
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

describe('CapsuleMembersService', () => {
  const capsuleId = '550e8400-e29b-41d4-a716-446655440001';
  const ownerId = '550e8400-e29b-41d4-a716-446655440000';
  const memberId = '550e8400-e29b-41d4-a716-446655440002';
  const otherId = '550e8400-e29b-41d4-a716-446655440003';
  const capsule = {
    id: capsuleId,
    ownerId,
    type: 'GROUP',
    status: 'COLLECTING',
  };
  const membership = {
    userId: memberId,
    role: 'MEMBER',
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    user: { name: 'Memora Member', username: 'member' },
  };
  let prisma: any;
  let service: CapsuleMembersService;

  beforeEach(() => {
    prisma = {
      capsule: { findUnique: jest.fn(), findFirst: jest.fn() },
      user: { findUnique: jest.fn() },
      capsuleMember: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      capsuleRemovedMember: { upsert: jest.fn(), deleteMany: jest.fn() },
      $transaction: jest.fn((operation: unknown) =>
        Array.isArray(operation)
          ? Promise.all(operation)
          : (operation as (tx: typeof prisma) => Promise<unknown>)(prisma),
      ),
    };
    prisma.capsuleMember.count.mockResolvedValue(1);
    service = new CapsuleMembersService(prisma, {
      getOrThrow: jest.fn().mockReturnValue(50),
    } as any);
  });

  it('adds an existing user as MEMBER', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);
    prisma.user.findUnique.mockResolvedValue({ id: memberId });
    prisma.capsuleMember.findUnique.mockResolvedValue(null);
    prisma.capsuleMember.create.mockResolvedValue(membership);

    await expect(service.add(capsuleId, ownerId, memberId)).resolves.toEqual({
      userId: memberId,
      name: 'Memora Member',
      username: 'member',
      role: 'MEMBER',
      joinedAt: membership.joinedAt,
    });
    expect(prisma.capsuleMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { capsuleId, userId: memberId, role: 'MEMBER' },
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('rejects a missing capsule or target user', async () => {
    prisma.capsule.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(capsule);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.add(capsuleId, ownerId, memberId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.add(capsuleId, ownerId, memberId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate membership and adding the owner', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);
    prisma.user.findUnique.mockResolvedValue({ id: memberId });
    prisma.capsuleMember.findUnique.mockResolvedValue({ id: 'existing' });

    await expect(
      service.add(capsuleId, ownerId, memberId),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.add(capsuleId, ownerId, ownerId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('allows only the owner to add members and only on collecting GROUP capsules', async () => {
    prisma.capsule.findUnique
      .mockResolvedValueOnce({ ...capsule, ownerId: otherId })
      .mockResolvedValueOnce({ ...capsule, status: 'CANCELLED' });

    await expect(
      service.add(capsuleId, ownerId, memberId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.add(capsuleId, ownerId, memberId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
  });

  it('enforces the capsule member limit for owner-added members', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);
    prisma.user.findUnique.mockResolvedValue({ id: memberId });
    prisma.capsuleMember.findUnique.mockResolvedValue(null);
    prisma.capsuleMember.count.mockResolvedValue(50);

    await expect(
      service.add(capsuleId, ownerId, memberId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
  });

  it('returns a paginated safe member list to an authorized member', async () => {
    prisma.capsule.findFirst.mockResolvedValue({ id: capsuleId });
    prisma.capsuleMember.findMany.mockResolvedValue([membership]);
    prisma.capsuleMember.count.mockResolvedValue(1);

    const result = await service.findAll(capsuleId, memberId, {
      page: 1,
      limit: 20,
    });

    expect(result).toEqual({
      items: [
        {
          userId: memberId,
          name: 'Memora Member',
          username: 'member',
          role: 'MEMBER',
          joinedAt: membership.joinedAt,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(JSON.stringify(result)).not.toContain('email');
  });

  it('does not disclose the member list to unauthorized users', async () => {
    prisma.capsule.findFirst.mockResolvedValue(null);
    await expect(
      service.findAll(capsuleId, otherId, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.capsuleMember.findMany).not.toHaveBeenCalled();
  });

  it('allows the owner to remove a member', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);
    prisma.capsuleMember.findUnique.mockResolvedValue({
      id: 'membership-id',
      entries: [],
    });
    prisma.capsuleMember.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.remove(capsuleId, ownerId, memberId)).resolves.toEqual(
      { userId: memberId, removed: true },
    );
    expect(prisma.capsuleRemovedMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capsuleId_userId: { capsuleId, userId: memberId } },
      }),
    );
  });

  it('allows members to leave but prevents removing the owner', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);
    prisma.capsuleMember.findUnique.mockResolvedValue({
      id: 'membership-id',
      entries: [],
    });
    prisma.capsuleMember.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      service.remove(capsuleId, memberId, memberId),
    ).resolves.toEqual({ userId: memberId, removed: true });
    expect(prisma.capsuleRemovedMember.upsert).not.toHaveBeenCalled();
    await expect(
      service.remove(capsuleId, ownerId, ownerId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unauthorized and missing member removal', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);

    await expect(
      service.remove(capsuleId, otherId, memberId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    prisma.capsuleMember.findUnique.mockResolvedValue(null);
    await expect(
      service.remove(capsuleId, ownerId, memberId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('preserves capsule entries by preventing removal of members who have content', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);
    prisma.capsuleMember.findUnique.mockResolvedValue({
      id: 'membership-id',
      entries: [{ id: 'entry-id' }],
    });

    await expect(
      service.remove(capsuleId, ownerId, memberId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.capsuleMember.deleteMany).not.toHaveBeenCalled();
  });

  it('updates a member role to MEMBER', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);
    prisma.capsuleMember.findUnique.mockResolvedValue({ id: 'membership-id' });
    prisma.capsuleMember.updateMany.mockResolvedValue({ count: 1 });
    prisma.capsuleMember.findUniqueOrThrow.mockResolvedValue(membership);

    await expect(
      service.updateRole(capsuleId, ownerId, memberId, 'MEMBER' as any),
    ).resolves.toHaveProperty('role', 'MEMBER');
    expect(prisma.capsuleMember.updateMany).toHaveBeenCalledWith({
      where: { capsuleId, userId: memberId },
      data: { role: 'MEMBER' },
    });
  });

  it('rejects unauthorized role changes, owner role changes, and OWNER promotion', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);

    await expect(
      service.updateRole(capsuleId, otherId, memberId, 'MEMBER' as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateRole(capsuleId, ownerId, ownerId, 'MEMBER' as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateRole(capsuleId, ownerId, memberId, 'OWNER' as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.capsuleMember.updateMany).not.toHaveBeenCalled();
  });
});
