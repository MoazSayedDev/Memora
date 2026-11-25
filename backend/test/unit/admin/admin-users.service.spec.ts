import { ForbiddenException } from '@nestjs/common';
import { AdminUsersService } from '../../../src/modules/admin/admin-users.service';

jest.mock('../../../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

describe('AdminUsersService', () => {
  const adminId = '550e8400-e29b-41d4-a716-446655440000';
  const users = [
    {
      id: adminId,
      name: 'Memora',
      username: 'memora_admin',
      email: 'memora@memora.com',
      isEmailVerified: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];
  let prisma: any;
  let service: AdminUsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new AdminUsersService(prisma);
  });

  it('lists safe user fields for the allowlisted admin email', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'MEMORA@MEMORA.COM',
    });
    prisma.user.findMany.mockResolvedValue(users);

    await expect(service.listUsers(adminId)).resolves.toEqual(users);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        isEmailVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.user.findMany.mock.calls[0][0].select).not.toHaveProperty(
      'passwordHash',
    );
  });

  it('denies users whose database email is not allowlisted', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'user@memora.com' });

    await expect(service.listUsers(adminId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('denies a missing authenticated user record', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.listUsers(adminId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
