import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CapsuleStatus, CapsuleType, MemberRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListCapsuleMembersDto } from './dto/list-capsule-members.dto';

const memberSelect = {
  userId: true,
  role: true,
  joinedAt: true,
  user: {
    select: {
      name: true,
      username: true,
    },
  },
} as const;

@Injectable()
export class CapsuleMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async add(capsuleId: string, ownerId: string, userId: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const capsule = await tx.capsule.findUnique({
            where: { id: capsuleId },
            select: { id: true, ownerId: true, type: true, status: true },
          });
          if (!capsule) {
            throw new NotFoundException('Capsule not found');
          }
          if (capsule.ownerId !== ownerId) {
            throw new ForbiddenException(
              'Only the capsule owner can add members',
            );
          }
          this.assertMembershipChangesAllowed(capsule);
          if (userId === capsule.ownerId) {
            throw new BadRequestException(
              'The capsule owner cannot be added as a member',
            );
          }

          const targetUser = await tx.user.findUnique({
            where: { id: userId },
            select: { id: true },
          });
          if (!targetUser) {
            throw new NotFoundException('User not found');
          }

          const existing = await tx.capsuleMember.findUnique({
            where: { capsuleId_userId: { capsuleId, userId } },
            select: { id: true },
          });
          if (existing) {
            throw new ConflictException('User is already a capsule member');
          }

          const memberCount = await tx.capsuleMember.count({
            where: { capsuleId },
          });
          const maxMembers = Number(
            this.configService.getOrThrow<number>('MAX_CAPSULE_MEMBERS'),
          );
          if (memberCount >= maxMembers) {
            throw new ConflictException(
              'Capsule has reached the maximum member limit',
            );
          }

          await tx.capsuleRemovedMember.deleteMany({
            where: { capsuleId, userId },
          });
          const membership = await tx.capsuleMember.create({
            data: { capsuleId, userId, role: MemberRole.MEMBER },
            select: memberSelect,
          });
          return this.mapMember(membership);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.throwForPrismaMutationError(
        error,
        'User is already a capsule member',
      );
    }
  }

  async findAll(
    capsuleId: string,
    userId: string,
    query: ListCapsuleMembersDto,
  ) {
    const capsule = await this.prisma.capsule.findFirst({
      where: {
        id: capsuleId,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      select: { id: true },
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { capsuleId };
    const [members, total] = await this.prisma.$transaction([
      this.prisma.capsuleMember.findMany({
        where,
        select: memberSelect,
        orderBy: { joinedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.capsuleMember.count({ where }),
    ]);

    return {
      items: members.map((member) => this.mapMember(member)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async remove(capsuleId: string, actorId: string, memberUserId: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const capsule = await tx.capsule.findUnique({
            where: { id: capsuleId },
            select: { id: true, ownerId: true, type: true, status: true },
          });
          if (!capsule) {
            throw new NotFoundException('Capsule not found');
          }
          if (memberUserId === capsule.ownerId) {
            throw new BadRequestException(
              'The capsule owner cannot be removed',
            );
          }
          if (actorId !== capsule.ownerId && actorId !== memberUserId) {
            throw new ForbiddenException(
              'Only the capsule owner can remove other members',
            );
          }
          this.assertMembershipChangesAllowed(capsule);

          const membership = await tx.capsuleMember.findUnique({
            where: {
              capsuleId_userId: { capsuleId, userId: memberUserId },
            },
            select: { id: true, entries: { select: { id: true } } },
          });
          if (!membership) {
            throw new NotFoundException('Capsule member not found');
          }
          if (membership.entries.length > 0) {
            throw new BadRequestException(
              'Members with capsule entries cannot be removed',
            );
          }

          const result = await tx.capsuleMember.deleteMany({
            where: { capsuleId, userId: memberUserId },
          });
          if (result.count === 0) {
            throw new ConflictException(
              'Membership changed; refresh and try again',
            );
          }
          if (actorId === capsule.ownerId) {
            await tx.capsuleRemovedMember.upsert({
              where: {
                capsuleId_userId: {
                  capsuleId,
                  userId: memberUserId,
                },
              },
              create: { capsuleId, userId: memberUserId },
              update: { removedAt: new Date() },
            });
          }
          return { userId: memberUserId, removed: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.throwForPrismaMutationError(
        error,
        'Membership changed; retry the request',
      );
    }
  }

  async updateRole(
    capsuleId: string,
    ownerId: string,
    memberUserId: string,
    role: MemberRole,
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const capsule = await tx.capsule.findUnique({
            where: { id: capsuleId },
            select: { id: true, ownerId: true, type: true, status: true },
          });
          if (!capsule) {
            throw new NotFoundException('Capsule not found');
          }
          if (capsule.ownerId !== ownerId) {
            throw new ForbiddenException(
              'Only the capsule owner can manage member roles',
            );
          }
          if (memberUserId === capsule.ownerId) {
            throw new BadRequestException(
              "The capsule owner's role cannot be changed",
            );
          }
          if (role !== MemberRole.MEMBER) {
            throw new BadRequestException(
              'Members cannot be promoted to OWNER',
            );
          }
          this.assertMembershipChangesAllowed(capsule);

          const membership = await tx.capsuleMember.findUnique({
            where: {
              capsuleId_userId: { capsuleId, userId: memberUserId },
            },
            select: { id: true },
          });
          if (!membership) {
            throw new NotFoundException('Capsule member not found');
          }

          const result = await tx.capsuleMember.updateMany({
            where: { capsuleId, userId: memberUserId },
            data: { role: MemberRole.MEMBER },
          });
          if (result.count === 0) {
            throw new ConflictException(
              'Membership changed; refresh and try again',
            );
          }
          const updatedMembership = await tx.capsuleMember.findUniqueOrThrow({
            where: {
              capsuleId_userId: { capsuleId, userId: memberUserId },
            },
            select: memberSelect,
          });
          return this.mapMember(updatedMembership);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.throwForPrismaMutationError(
        error,
        'Membership changed; retry the request',
      );
    }
  }

  private assertMembershipChangesAllowed(capsule: {
    type: CapsuleType;
    status: CapsuleStatus;
  }) {
    if (
      capsule.type !== CapsuleType.GROUP ||
      capsule.status !== CapsuleStatus.COLLECTING
    ) {
      throw new BadRequestException(
        'Membership can only be changed on collecting GROUP capsules',
      );
    }
  }

  private mapMember(member: {
    userId: string;
    role: MemberRole;
    joinedAt: Date;
    user: { name: string; username: string | null };
  }) {
    return {
      userId: member.userId,
      name: member.user.name,
      username: member.user.username,
      role: member.role,
      joinedAt: member.joinedAt,
    };
  }

  private throwForPrismaMutationError(
    error: unknown,
    duplicateMessage: string,
  ): never {
    const code = this.getPrismaErrorCode(error);
    if (code === 'P2002') {
      throw new ConflictException(duplicateMessage);
    }
    if (code === 'P2034') {
      throw new ConflictException(
        'Capsule or membership changed; refresh and try again',
      );
    }
    throw error;
  }

  private getPrismaErrorCode(error: unknown): string | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      return error.code;
    }
    return undefined;
  }
}
