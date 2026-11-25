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
    owner: { name: 'Owner', username: 'owner' },
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

  beforeEach(() => {
    prisma = {
      capsule: { findUnique: jest.fn() },
      invitationLink: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      capsuleMember: { findUnique: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(
        (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
      ),
    };
    service = new InvitationsService(prisma, {
      getOrThrow: jest.fn().mockReturnValue('https://memora.example'),
    } as any);
  });

  it('creates an owner invitation with only a token hash persisted', async () => {
    prisma.capsule.findUnique.mockResolvedValue({
      id: capsuleId,
      ownerId,
      type: 'GROUP',
      status: 'COLLECTING',
    });
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
    });
    expect(result).not.toHaveProperty('tokenHash');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('prevents a non-owner from creating an invitation', async () => {
    prisma.capsule.findUnique.mockResolvedValue({
      id: capsuleId,
      ownerId: memberId,
      type: 'GROUP',
      status: 'COLLECTING',
    });
    await expect(service.create(capsuleId, ownerId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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
    expect(result.membership.role).toBe('MEMBER');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
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
