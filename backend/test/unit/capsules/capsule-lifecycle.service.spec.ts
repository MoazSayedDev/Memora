import { BadRequestException, NotFoundException } from '@nestjs/common';
jest.mock('../../../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../../../src/modules/email/email.service', () => ({
  EmailService: class {},
}));
import { CapsuleLifecycleService } from '../../../src/modules/capsules/capsule-lifecycle.service';

describe('CapsuleLifecycleService', () => {
  const capsuleId = '550e8400-e29b-41d4-a716-446655440001';
  const ownerId = '550e8400-e29b-41d4-a716-446655440000';
  let prisma: any;
  let capsulesService: any;
  let events: any;
  let emailService: any;
  let service: CapsuleLifecycleService;

  beforeEach(() => {
    prisma = {
      capsule: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    capsulesService = {
      findOne: jest.fn().mockResolvedValue({ id: capsuleId }),
    };
    events = {
      capsuleClosed: jest.fn(),
      capsuleOpened: jest.fn(),
    };
    emailService = {
      sendCapsuleOpened: jest.fn().mockResolvedValue(undefined),
    };
    service = new CapsuleLifecycleService(
      prisma,
      capsulesService,
      events,
      emailService,
    );
  });

  it('rejects schedules where openAt is not later than closeAt', async () => {
    const now = Date.now();
    prisma.capsule.findFirst.mockResolvedValue({
      id: capsuleId,
      status: 'COLLECTING',
      opensAt: new Date(now + 60_000),
      closeAt: null,
    });

    await expect(
      service.updateSchedule(ownerId, capsuleId, {
        closeAt: new Date(now + 120_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.capsule.updateMany).not.toHaveBeenCalled();
  });

  it('allows a closed capsule owner to move openAt without reopening it', async () => {
    const closeAt = new Date(Date.now() - 60_000);
    prisma.capsule.findFirst.mockResolvedValue({
      id: capsuleId,
      status: 'CLOSED',
      opensAt: new Date(Date.now() + 60_000),
      closeAt,
    });
    prisma.capsule.updateMany.mockResolvedValue({ count: 1 });

    const openAt = new Date(Date.now() + 120_000).toISOString();
    await service.updateSchedule(ownerId, capsuleId, { openAt });

    expect(prisma.capsule.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: capsuleId, ownerId, status: 'CLOSED' },
        data: { opensAt: new Date(openAt) },
      }),
    );
  });

  it('closes a collecting capsule immediately and is idempotent', async () => {
    prisma.capsule.findFirst
      .mockResolvedValueOnce({
        id: capsuleId,
        status: 'COLLECTING',
        opensAt: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce({
        id: capsuleId,
        status: 'CLOSED',
        opensAt: new Date(Date.now() + 60_000),
      });
    prisma.capsule.updateMany.mockResolvedValue({ count: 1 });

    await service.closeNow(ownerId, capsuleId);
    await service.closeNow(ownerId, capsuleId);

    expect(prisma.capsule.updateMany).toHaveBeenCalledTimes(1);
    expect(events.capsuleClosed).toHaveBeenCalledTimes(1);
  });

  it('requires an opening date before manual close', async () => {
    prisma.capsule.findFirst.mockResolvedValue({
      id: capsuleId,
      status: 'COLLECTING',
      opensAt: null,
    });

    await expect(service.closeNow(ownerId, capsuleId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.capsule.updateMany).not.toHaveBeenCalled();
  });

  it('closes and opens due capsules and preserves legacy opening-only schedules', async () => {
    prisma.capsule.findMany
      .mockResolvedValueOnce([{ id: capsuleId }])
      .mockResolvedValueOnce([
        { id: capsuleId, status: 'CLOSED' },
        { id: 'legacy-capsule', status: 'COLLECTING' },
        { id: 'legacy-personal-capsule', status: 'DRAFT' },
      ]);
    prisma.capsule.updateMany.mockResolvedValue({ count: 1 });
    prisma.capsule.findUnique.mockResolvedValue({
      name: 'Memories',
      members: [
        { user: { email: 'member@example.com' } },
        { user: { email: 'another-member@example.com' } },
      ],
    });

    await service.processDueCapsules();

    expect(prisma.capsule.updateMany).toHaveBeenCalledTimes(4);
    expect(events.capsuleClosed).toHaveBeenCalledWith(
      capsuleId,
      expect.any(Date),
    );
    expect(events.capsuleOpened).toHaveBeenCalledTimes(3);
    expect(emailService.sendCapsuleOpened).toHaveBeenCalledTimes(6);
    expect(emailService.sendCapsuleOpened).toHaveBeenCalledWith(
      'member@example.com',
      'Memories',
    );
    expect(emailService.sendCapsuleOpened).toHaveBeenCalledWith(
      'another-member@example.com',
      'Memories',
    );
  });

  it('does not email capsule members if another worker already opened the capsule', async () => {
    prisma.capsule.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: capsuleId, status: 'CLOSED' }]);
    prisma.capsule.updateMany.mockResolvedValue({ count: 0 });

    await service.processDueCapsules();

    expect(prisma.capsule.findUnique).not.toHaveBeenCalled();
    expect(emailService.sendCapsuleOpened).not.toHaveBeenCalled();
  });

  it('does not transition cancelled capsules', async () => {
    prisma.capsule.findMany.mockResolvedValue([]);

    await service.processDueCapsules();

    expect(prisma.capsule.updateMany).not.toHaveBeenCalled();
    expect(events.capsuleOpened).not.toHaveBeenCalled();
  });

  it('rejects schedule changes for capsules not owned by the user', async () => {
    prisma.capsule.findFirst.mockResolvedValue(null);

    await expect(
      service.updateSchedule(ownerId, capsuleId, {
        openAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
