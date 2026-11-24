/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../../../src/modules/users/users.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('@prisma/client', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
      }
    },
  },
}));
jest.mock('../../../src/prisma/prisma.service', () => ({
  PrismaService: class {},
}));

describe('UsersService', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000';
  const safeUser = {
    id: userId,
    username: 'memora_user',
    name: 'Memora User',
    email: 'user@memora.test',
    isEmailVerified: true,
  };

  let prisma: any;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      refreshToken: { updateMany: jest.fn(), deleteMany: jest.fn() },
      capsule: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      capsuleMember: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      capsuleEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
      },
      entryAttachment: { deleteMany: jest.fn() },
      invitationLink: { deleteMany: jest.fn() },
      emailVerificationToken: { deleteMany: jest.fn() },
      passwordResetToken: { deleteMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string, defaultValue?: unknown) =>
        key === 'BCRYPT_ROUNDS' ? 12 : defaultValue,
      ),
    };
    service = new UsersService(prisma, configService as any);
  });

  it('gets the current safe profile', async () => {
    prisma.user.findUnique.mockResolvedValue(safeUser);
    await expect(service.getCurrentProfile(userId)).resolves.toEqual(safeUser);
  });

  it('returns not found for a missing current profile', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getCurrentProfile(userId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns only public fields for another user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      username: 'memora_user',
      name: 'Memora User',
    });
    await expect(service.getPublicProfile(userId)).resolves.toEqual({
      id: userId,
      username: 'memora_user',
      name: 'Memora User',
    });
  });

  it('updates a profile successfully', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue({ ...safeUser, name: 'Updated Name' });
    await expect(
      service.updateProfile(userId, { name: 'Updated Name' }),
    ).resolves.toHaveProperty('name', 'Updated Name');
  });

  it('rejects an existing username', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'other-user' });
    await expect(
      service.updateProfile(userId, { username: 'taken_username' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects protected or empty mass-assignment updates', async () => {
    await expect(
      service.updateProfile(userId, {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateProfile(userId, {
        email: 'changed@memora.test',
        isEmailVerified: false,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('changes a password and revokes sessions', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      passwordHash: 'current-hash',
    });
    (bcrypt.compare as jest.Mock)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await expect(
      service.changePassword(userId, {
        currentPassword: 'password123',
        newPassword: 'new-password123',
      }),
    ).resolves.toEqual({ message: 'Password changed successfully' });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
  });

  it('rejects an incorrect current password', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      passwordHash: 'current-hash',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.changePassword(userId, {
        currentPassword: 'wrong-password',
        newPassword: 'new-password123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('deletes an account after password confirmation', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      passwordHash: 'current-hash',
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma),
    );

    await expect(
      service.deleteAccount(userId, { password: 'password123' }),
    ).resolves.toEqual({ message: 'Account deleted successfully' });
  });
});
