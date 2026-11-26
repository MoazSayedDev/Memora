import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InvitationsService } from '../../../src/modules/invitations/invitations.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('@prisma/client', () => ({
  CapsuleStatus: {
    DRAFT: 'DRAFT',
    COLLECTING: 'COLLECTING',
    OPEN: 'OPEN',
    CANCELLED: 'CANCELLED',
  },
  CapsuleType: { PERSONAL: 'PERSONAL', GROUP: 'GROUP' },
  InvitationStatus: { ACTIVE: 'ACTIVE', REVOKED: 'REVOKED' },
  MemberRole: { OWNER: 'OWNER', MEMBER: 'MEMBER' },
  Prisma: { TransactionIsolationLevel: { Serializable: 'Serializable' } },
}));
jest.mock('../../../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

describe('InvitationsService', () => {
  const capsuleId = '550e8400-e29b-41d4-a716-446655440001';
  const invitationId = '550e8400-e29b-41d4-a716-446655440002';
  const ownerId = '550e8400-e29b-41d4-a716-446655440000';
  const memberId = '550e8400-e29b-41d4-a716-446655440003';
  const rawToken = 'a'.repeat(43);
  const capsule = {
    id: capsuleId,
    ownerId,
    name: 'Summer',
    description: 'Shared memories',
    type: 'GROUP',
    status: 'COLLECTING',
    opensAt: new Date('2030-01-01T00:00:00.000Z'),
    owner: {
      name: 'Owner',
      username: 'owner',
      email: 'owner@memora.test',
    },
  };
  const invitation = {
    id: invitationId,
    capsuleId,
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 60_000),
    maxUses: null,
    usageCount: 0,
    capsule,
  };
  let prisma: any;
  let service: InvitationsService;
  const emailService = {
    sendCapsuleInvitation: jest.fn().mockResolvedValue(undefined),
    sendCapsuleMemberJoined: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      capsule: { findUnique: jest.fn().mockResolvedValue(capsule) },
      invitationLink: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      capsuleMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: '550e8400-e29b-41d4-a716-446655440004',
          role: 'MEMBER',
          joinedAt: new Date(),
        }),
        count: jest.fn().mockResolvedValue(1),
      },
      capsuleRemovedMember: { findUnique: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'Member',
          isEmailVerified: true,
        }),
      },
      $transaction: jest.fn((operation: unknown) =>
        Array.isArray(operation)
          ? Promise.all(operation)
          : (operation as (tx: typeof prisma) => Promise<unknown>)(prisma),
      ),
    };
    prisma.invitationLink.updateMany.mockResolvedValue({ count: 1 });
    service = new InvitationsService(
      prisma,
      {
        getOrThrow: jest.fn((key: string) => {
          const values: Record<string, string> = {
            FRONTEND_URL: 'https://memora.example',
            MAX_CAPSULE_MEMBERS: '50',
            INVITATION_RETENTION_DAYS: '30',
          };
          return values[key];
        }),
      } as any,
      emailService as any,
    );
  });

  it('creates an owner invitation with only a token hash persisted', async () => {
    prisma.capsule.findUnique.mockResolvedValue(capsule);
    prisma.invitationLink.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: invitationId,
        expiresAt: data.expiresAt,
      }),
    );

    const result = await service.create(capsuleId, ownerId);
    const rawCreatedToken =
      new URL(result.invitationUrl).pathname.split('/').at(-1) ?? '';
    const data = prisma.invitationLink.create.mock.calls[0][0].data;

    expect(rawCreatedToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.tokenHash).toBe(
      createHash('sha256').update(rawCreatedToken).digest('hex'),
    );
    expect(data.tokenHash).not.toBe(rawCreatedToken);
    expect(data).toMatchObject({
      capsuleId,
      createdBy: ownerId,
      status: 'ACTIVE',
      maxUses: null,
    });
    expect(result).not.toHaveProperty('tokenHash');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    );
  });

  it('persists custom invitation use limits and expiry', async () => {
    prisma.invitationLink.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: invitationId,
        expiresAt: data.expiresAt,
      }),
    );

    const result = await service.create(capsuleId, ownerId, {
      maxUses: 3,
      expiresInDays: 2,
    });

    expect(prisma.invitationLink.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          maxUses: 3,
          expiresAt: expect.any(Date),
        }),
      }),
    );
    expect(
      (
        prisma.invitationLink.create.mock.calls[0][0].data.expiresAt as Date
      ).getTime(),
    ).toBeLessThanOrEqual(Date.now() + 2 * 24 * 60 * 60 * 1000);
    expect(result.id).toBe(invitationId);
  });

  it('creates and emails a limited invitation', async () => {
    prisma.invitationLink.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: invitationId,
        expiresAt: data.expiresAt,
      }),
    );

    await expect(
      service.sendToEmail(capsuleId, ownerId, {
        email: 'invitee@memora.test',
        maxUses: 2,
        expiresInDays: 3,
      }),
    ).resolves.toMatchObject({
      id: invitationId,
      email: 'invitee@memora.test',
    });
    expect(emailService.sendCapsuleInvitation).toHaveBeenCalledWith(
      'invitee@memora.test',
      'Summer',
      expect.stringMatching(/^https:\/\/memora\.example\/invitations\//),
    );
    expect(prisma.invitationLink.create.mock.calls[0][0].data).toMatchObject({
      maxUses: 2,
    });
  });

  it('revokes an emailed invitation if email delivery fails', async () => {
    prisma.invitationLink.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: invitationId,
        expiresAt: data.expiresAt,
      }),
    );
    emailService.sendCapsuleInvitation.mockRejectedValueOnce(
      new Error('SMTP failed'),
    );

    await expect(
      service.sendToEmail(capsuleId, ownerId, {
        email: 'invitee@memora.test',
        maxUses: null,
        expiresInDays: 7,
      }),
    ).rejects.toThrow('SMTP failed');
    expect(prisma.invitationLink.updateMany).toHaveBeenCalledWith({
      where: { id: invitationId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
  });

  it('prevents a non-owner from creating an invitation', async () => {
    prisma.capsule.findUnique.mockResolvedValue({
      ...capsule,
      ownerId: memberId,
    });
    await expect(service.create(capsuleId, ownerId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lists active and revoked invitations for the owner without exposing tokens', async () => {
    const activeInvitation = {
      id: invitationId,
      status: 'ACTIVE',
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
      expiresAt: new Date('2030-01-08T00:00:00.000Z'),
      maxUses: null,
      usageCount: 2,
    };
    const revokedInvitation = {
      ...activeInvitation,
      id: '550e8400-e29b-41d4-a716-446655440004',
      status: 'REVOKED',
      usageCount: 1,
    };
    prisma.capsule.findUnique.mockResolvedValue({ ownerId });
    prisma.invitationLink.findMany.mockResolvedValue([
      activeInvitation,
      revokedInvitation,
    ]);
    prisma.invitationLink.count.mockResolvedValue(2);

    await expect(
      service.findAll(capsuleId, ownerId, { page: 1, limit: 20 }),
    ).resolves.toEqual({
      items: [activeInvitation, revokedInvitation],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });
    expect(prisma.invitationLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capsuleId },
        select: expect.not.objectContaining({ tokenHash: true }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith([
      expect.anything(),
      expect.anything(),
    ]);
  });

  it('filters invitation listings by status and prevents non-owners from listing', async () => {
    prisma.capsule.findUnique
      .mockResolvedValueOnce({ ownerId })
      .mockResolvedValueOnce({ ownerId: memberId });
    prisma.invitationLink.findMany.mockResolvedValue([]);
    prisma.invitationLink.count.mockResolvedValue(0);

    await service.findAll(capsuleId, ownerId, {
      status: 'REVOKED' as any,
      page: 2,
      limit: 10,
    });
    expect(prisma.invitationLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { capsuleId, status: 'REVOKED' },
        skip: 10,
        take: 10,
      }),
    );
    await expect(
      service.findAll(capsuleId, ownerId, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports an active-but-expired link as EXPIRED in listings', async () => {
    const expiresAt = new Date(Date.now() - 1);
    prisma.capsule.findUnique.mockResolvedValue({ ownerId });
    prisma.invitationLink.findMany.mockResolvedValue([
      {
        id: invitationId,
        status: 'ACTIVE',
        createdAt: new Date(),
        expiresAt,
        maxUses: null,
        usageCount: 0,
      },
    ]);
    prisma.invitationLink.count.mockResolvedValue(1);

    const result = await service.findAll(capsuleId, ownerId, {
      status: 'EXPIRED' as any,
      page: 1,
      limit: 20,
    });

    expect(result.items[0].status).toBe('EXPIRED');
    expect(prisma.invitationLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          capsuleId,
          status: 'ACTIVE',
          expiresAt: { lte: expect.any(Date) },
        },
      }),
    );
  });

  it('returns not found when listing invitations for a missing capsule', async () => {
    prisma.capsule.findUnique.mockResolvedValue(null);
    await expect(
      service.findAll(capsuleId, ownerId, { page: 1, limit: 20 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects invitations for PERSONAL capsules and ineligible statuses', async () => {
    prisma.capsule.findUnique
      .mockResolvedValueOnce({
        id: capsuleId,
        ownerId,
        type: 'PERSONAL',
        status: 'DRAFT',
      })
      .mockResolvedValueOnce({
        id: capsuleId,
        ownerId,
        type: 'GROUP',
        status: 'OPEN',
      });

    await expect(service.create(capsuleId, ownerId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.create(capsuleId, ownerId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('revokes an active invitation owned by the capsule owner', async () => {
    prisma.capsule.findUnique.mockResolvedValue({ ownerId });
    prisma.invitationLink.findFirst.mockResolvedValue({
      id: invitationId,
      status: 'ACTIVE',
    });
    prisma.invitationLink.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.revoke(capsuleId, invitationId, ownerId),
    ).resolves.toEqual({ id: invitationId, status: 'REVOKED' });
    expect(prisma.invitationLink.updateMany).toHaveBeenCalledWith({
      where: { id: invitationId, capsuleId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
  });

  it('prevents a non-owner from revoking an invitation', async () => {
    prisma.capsule.findUnique.mockResolvedValue({ ownerId: memberId });
    await expect(
      service.revoke(capsuleId, invitationId, ownerId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not revoke an invitation belonging to another capsule', async () => {
    prisma.capsule.findUnique.mockResolvedValue({ ownerId });
    prisma.invitationLink.findFirst.mockResolvedValue(null);
    await expect(
      service.revoke(capsuleId, invitationId, ownerId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.invitationLink.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an already revoked invitation', async () => {
    prisma.capsule.findUnique.mockResolvedValue({ ownerId });
    prisma.invitationLink.findFirst.mockResolvedValue({
      id: invitationId,
      status: 'REVOKED',
    });

    await expect(
      service.revoke(capsuleId, invitationId, ownerId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('regenerates an invitation atomically and revokes the old link', async () => {
    prisma.invitationLink.findFirst.mockResolvedValue({
      id: invitationId,
      status: 'ACTIVE',
    });
    prisma.invitationLink.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: '550e8400-e29b-41d4-a716-446655440005',
        expiresAt: data.expiresAt,
      }),
    );

    const result = await service.regenerate(capsuleId, invitationId, ownerId, {
      maxUses: 5,
      expiresInDays: 4,
    });

    expect(result.id).toBe('550e8400-e29b-41d4-a716-446655440005');
    expect(result.invitationUrl).toContain('/invitations/');
    expect(prisma.invitationLink.updateMany).toHaveBeenCalledWith({
      where: { id: invitationId, capsuleId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
    expect(prisma.invitationLink.create.mock.calls[0][0].data).toMatchObject({
      maxUses: 5,
      status: 'ACTIVE',
    });
  });

  it('revokes all active invitation links for the capsule owner', async () => {
    prisma.invitationLink.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.revokeAll(capsuleId, ownerId)).resolves.toEqual({
      revokedCount: 3,
    });
    expect(prisma.invitationLink.updateMany).toHaveBeenCalledWith({
      where: { capsuleId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
  });

  it('cleans up active expired invitations after the configured retention period', async () => {
    prisma.invitationLink.deleteMany.mockResolvedValue({ count: 4 });
    await expect(service.cleanupExpiredInvitations()).resolves.toBe(4);
    expect(prisma.invitationLink.deleteMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: expect.any(Date) },
      },
    });
  });

  it('returns only safe preview data for a valid invitation', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue({
      ...invitation,
      tokenHash: 'secret-hash',
      capsule: { ...capsule, entries: [{ text: 'private' }] },
    });

    const result = await service.validate(rawToken);

    expect(result).toEqual({
      capsule: {
        id: capsuleId,
        title: 'Summer',
        description: 'Shared memories',
        openingDate: capsule.opensAt,
        owner: { name: 'Owner', username: 'owner' },
      },
      expiresAt: invitation.expiresAt,
    });
    expect(result).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('rejects malformed, unknown, expired, and revoked invitation tokens', async () => {
    await expect(service.validate('bad')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.invitationLink.findUnique).not.toHaveBeenCalled();

    prisma.invitationLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...invitation,
        expiresAt: new Date(Date.now() - 1),
      })
      .mockResolvedValueOnce({ ...invitation, status: 'REVOKED' });

    await expect(service.validate(rawToken)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.validate(rawToken)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.validate(rawToken)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['PERSONAL', 'COLLECTING'],
    ['GROUP', 'CANCELLED'],
    ['GROUP', 'OPEN'],
  ])('does not preview a %s capsule in %s status', async (type, status) => {
    prisma.invitationLink.findUnique.mockResolvedValue({
      ...invitation,
      capsule: { ...capsule, type, status },
    });
    await expect(service.validate(rawToken)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('joins a GROUP capsule as MEMBER', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue(invitation);
    prisma.capsuleMember.findUnique.mockResolvedValue(null);
    prisma.capsuleMember.create.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440004',
      role: 'MEMBER',
      joinedAt: new Date(),
    });
    prisma.invitationLink.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.join(rawToken, memberId);

    expect(prisma.capsuleMember.create).toHaveBeenCalledWith({
      data: { capsuleId, userId: memberId, role: 'MEMBER' },
      select: { id: true, role: true, joinedAt: true },
    });
    expect(
      prisma.invitationLink.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.capsuleMember.create.mock.invocationCallOrder[0]);
    expect(result.membership.role).toBe('MEMBER');
    expect(emailService.sendCapsuleMemberJoined).toHaveBeenCalledWith(
      'owner@memora.test',
      'Summer',
      'Member',
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('checks maxUses before creating membership and rejects a raced final use', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue({
      ...invitation,
      maxUses: 1,
      usageCount: 0,
    });
    prisma.invitationLink.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.invitationLink.updateMany).toHaveBeenCalled();
    expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
  });

  it('rejects a link whose maximum use count has already been reached', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue({
      ...invitation,
      maxUses: 1,
      usageCount: 1,
    });

    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.invitationLink.updateMany).not.toHaveBeenCalled();
    expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
  });

  it('rejects expired links and links to cancelled capsules', async () => {
    prisma.invitationLink.findUnique
      .mockResolvedValueOnce({
        ...invitation,
        expiresAt: new Date(Date.now() - 1),
      })
      .mockResolvedValueOnce({
        ...invitation,
        capsule: { ...capsule, status: 'CANCELLED' },
      });

    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
  });

  it('blocks users removed by the capsule owner from rejoining by invitation', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue(invitation);
    prisma.capsuleRemovedMember.findUnique.mockResolvedValue({
      userId: memberId,
    });

    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.invitationLink.updateMany).not.toHaveBeenCalled();
    expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
  });

  it('allows a user who left voluntarily to rejoin by invitation', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue(invitation);
    prisma.capsuleRemovedMember.findUnique.mockResolvedValue(null);

    await expect(service.join(rawToken, memberId)).resolves.toHaveProperty(
      'membership.role',
      'MEMBER',
    );
    expect(prisma.capsuleRemovedMember.findUnique).toHaveBeenCalled();
  });

  it('requires a verified email before joining', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue(invitation);
    prisma.user.findUnique.mockResolvedValue({
      name: 'Member',
      isEmailVerified: false,
    });

    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.invitationLink.updateMany).not.toHaveBeenCalled();
    expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
  });

  it('enforces the configured maximum capsule member count', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue(invitation);
    prisma.capsuleMember.count.mockResolvedValue(50);

    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.invitationLink.updateMany).not.toHaveBeenCalled();
    expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
  });

  it('prevents the owner and existing members from joining', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue(invitation);
    await expect(service.join(rawToken, ownerId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.capsuleMember.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects expired, revoked, and PERSONAL capsule join attempts', async () => {
    prisma.invitationLink.findUnique
      .mockResolvedValueOnce({
        ...invitation,
        expiresAt: new Date(Date.now() - 1),
      })
      .mockResolvedValueOnce({ ...invitation, status: 'REVOKED' })
      .mockResolvedValueOnce({
        ...invitation,
        capsule: { ...capsule, type: 'PERSONAL' },
      });

    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'OPEN'])(
    'rejects joining a GROUP capsule in %s status',
    async (status) => {
      prisma.invitationLink.findUnique.mockResolvedValue({
        ...invitation,
        capsule: { ...capsule, status },
      });

      await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.capsuleMember.create).not.toHaveBeenCalled();
    },
  );

  it('translates a concurrent duplicate membership constraint into a conflict', async () => {
    prisma.invitationLink.findUnique.mockResolvedValue(invitation);
    prisma.capsuleMember.findUnique.mockResolvedValue(null);
    prisma.capsuleMember.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.join(rawToken, memberId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates only one membership for concurrent join requests', async () => {
    const memberships = new Set<string>();
    prisma.invitationLink.findUnique.mockResolvedValue(invitation);
    prisma.capsuleMember.findUnique.mockImplementation(() =>
      memberships.has(`${capsuleId}:${memberId}`) ? { id: 'existing' } : null,
    );
    prisma.capsuleMember.create.mockImplementation(() => {
      const membershipKey = `${capsuleId}:${memberId}`;
      if (memberships.has(membershipKey)) {
        throw Object.assign(new Error('Duplicate membership'), {
          code: 'P2002',
        });
      }
      memberships.add(membershipKey);
      return { id: 'member-id', role: 'MEMBER', joinedAt: new Date() };
    });
    prisma.invitationLink.updateMany.mockResolvedValue({ count: 1 });

    const results = await Promise.allSettled([
      service.join(rawToken, memberId),
      service.join(rawToken, memberId),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(memberships.size).toBe(1);
  });
});
