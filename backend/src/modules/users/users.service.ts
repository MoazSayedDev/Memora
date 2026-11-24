import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';

export type SafeUserProfile = {
  id: string;
  username: string | null;
  name: string;
  email: string;
  isEmailVerified: boolean;
};

export type PublicUserProfile = {
  id: string;
  username: string | null;
  name: string;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getCurrentProfile(userId: string): Promise<SafeUserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        isEmailVerified: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async getPublicProfile(userId: string): Promise<PublicUserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        name: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<SafeUserProfile> {
    const data: UpdateUserProfileDto = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.username !== undefined) {
      data.username = dto.username;
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('At least one profile field is required');
    }

    if (data.username) {
      const existing = await this.prisma.user.findFirst({
        where: {
          username: data.username,
          NOT: { id: userId },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException('Username already exists');
      }
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          isEmailVerified: true,
        },
      });
      return user;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Username already exists');
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currentPasswordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!currentPasswordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const passwordHash = await bcrypt.hash(
      dto.newPassword,
      this.getBcryptRounds(),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return { message: 'Password changed successfully' };
  }

  async deleteAccount(
    userId: string,
    dto: DeleteAccountDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Password is incorrect');
    }

    await this.prisma.$transaction(async (tx) => {
      const ownedCapsules = await tx.capsule.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });
      const ownedCapsuleIds = ownedCapsules.map((capsule) => capsule.id);

      if (ownedCapsuleIds.length > 0) {
        const ownedMembers = await tx.capsuleMember.findMany({
          where: { capsuleId: { in: ownedCapsuleIds } },
          select: { id: true },
        });
        const memberIds = ownedMembers.map((member) => member.id);
        const entries = await tx.capsuleEntry.findMany({
          where:
            memberIds.length > 0
              ? { capsuleMemberId: { in: memberIds } }
              : { capsuleMemberId: { in: ['none'] } },
          select: { id: true },
        });
        const entryIds = entries.map((entry) => entry.id);
        if (entryIds.length > 0) {
          await tx.entryAttachment.deleteMany({
            where: { entryId: { in: entryIds } },
          });
        }
        if (memberIds.length > 0) {
          await tx.capsuleEntry.deleteMany({
            where: { capsuleMemberId: { in: memberIds } },
          });
        }
        await tx.invitationLink.deleteMany({
          where: { capsuleId: { in: ownedCapsuleIds } },
        });
        await tx.capsuleMember.deleteMany({
          where: { capsuleId: { in: ownedCapsuleIds } },
        });
        await tx.capsule.deleteMany({
          where: { id: { in: ownedCapsuleIds } },
        });
      }

      const memberOfCapsules = await tx.capsuleMember.findMany({
        where: { userId },
        select: { id: true },
      });
      const memberIds = memberOfCapsules.map((member) => member.id);
      if (memberIds.length > 0) {
        const entries = await tx.capsuleEntry.findMany({
          where: { capsuleMemberId: { in: memberIds } },
          select: { id: true },
        });
        const entryIds = entries.map((entry) => entry.id);
        if (entryIds.length > 0) {
          await tx.entryAttachment.deleteMany({
            where: { entryId: { in: entryIds } },
          });
        }
        await tx.capsuleEntry.deleteMany({
          where: { capsuleMemberId: { in: memberIds } },
        });
        await tx.capsuleMember.deleteMany({ where: { userId } });
      }
      await tx.invitationLink.deleteMany({ where: { createdBy: userId } });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });

    return { message: 'Account deleted successfully' };
  }

  private getBcryptRounds(): number {
    const rounds = this.configService.get<number>('BCRYPT_ROUNDS', 12);
    return Number.isInteger(rounds) && rounds >= 10 && rounds <= 14
      ? rounds
      : 12;
  }
}
