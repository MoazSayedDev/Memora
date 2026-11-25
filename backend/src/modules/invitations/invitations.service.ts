import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CapsuleStatus,
  CapsuleType,
  InvitationStatus,
  MemberRole,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ListInvitationsDto } from './dto/list-invitations.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_INVITATION_MESSAGE = 'Invitation not found or unavailable';
const invitationSelect = {
  id: true,
  capsuleId: true,
  status: true,
  expiresAt: true,
  maxUses: true,
  usageCount: true,
  capsule: {
    select: {
      id: true,
      ownerId: true,
      name: true,
      description: true,
      type: true,
      status: true,
      opensAt: true,
      owner: {
        select: {
          name: true,
          username: true,
        },
      },
    },
  },
} as const;

type InvitationRecord = {
  id: string;
  capsuleId: string;
  status: InvitationStatus;
  expiresAt: Date;
  maxUses: number | null;
  usageCount: number;
  capsule: {
    id: string;
    ownerId: string;
    name: string;
    description: string | null;
    type: CapsuleType;
    status: CapsuleStatus;
    opensAt: Date | null;
    owner: { name: string; username: string | null };
  } | null;
};

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(capsuleId: string, userId: string) {
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const invitationUrl = new URL(
      `invitations/${rawToken}`,
      `${frontendUrl.replace(/\/+$/, '')}/`,
    ).toString();
    let invitation: { id: string; expiresAt: Date };
    try {
      invitation = await this.prisma.$transaction(
        async (tx) => {
          const capsule = await tx.capsule.findUnique({
            where: { id: capsuleId },
            select: { id: true, ownerId: true, type: true, status: true },
          });
          if (!capsule) {
            throw new NotFoundException('Capsule not found');
          }
          if (capsule.ownerId !== userId) {
            throw new ForbiddenException(
              'Only the capsule owner can invite members',
            );
          }
          if (capsule.type !== CapsuleType.GROUP) {
            throw new BadRequestException(
              'Only GROUP capsules support invitations',
            );
          }
          if (capsule.status !== CapsuleStatus.COLLECTING) {
            throw new BadRequestException(
              'Invitations can only be created for collecting capsules',
            );
          }

          return tx.invitationLink.create({
            data: {
              capsuleId,
              createdBy: userId,
              tokenHash: this.hashToken(rawToken),
              status: InvitationStatus.ACTIVE,
              expiresAt,
            },
            select: { id: true, expiresAt: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (this.getPrismaErrorCode(error) === 'P2034') {
        throw new ConflictException('Capsule changed; refresh and try again');
      }
      throw error;
    }

    return {
      id: invitation.id,
      invitationUrl,
      expiresAt: invitation.expiresAt,
    };
  }

  async findAll(capsuleId: string, userId: string, query: ListInvitationsDto) {
    const capsule = await this.prisma.capsule.findUnique({
      where: { id: capsuleId },
      select: { ownerId: true },
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }
    if (capsule.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the capsule owner can list invitations',
      );
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.InvitationLinkWhereInput = {
      capsuleId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [invitations, total] = await this.prisma.$transaction([
      this.prisma.invitationLink.findMany({
        where,
        select: {
          id: true,
          status: true,
          createdAt: true,
          expiresAt: true,
          maxUses: true,
          usageCount: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invitationLink.count({ where }),
    ]);

    return {
      items: invitations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async revoke(capsuleId: string, invitationId: string, userId: string) {
    const capsule = await this.prisma.capsule.findUnique({
      where: { id: capsuleId },
      select: { ownerId: true },
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }
    if (capsule.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the capsule owner can revoke invitations',
      );
    }

    const invitation = await this.prisma.invitationLink.findFirst({
      where: { id: invitationId, capsuleId },
      select: { id: true, status: true },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== InvitationStatus.ACTIVE) {
      throw new ConflictException('Invitation is already revoked');
    }

    const result = await this.prisma.invitationLink.updateMany({
      where: {
        id: invitationId,
        capsuleId,
        status: InvitationStatus.ACTIVE,
      },
      data: { status: InvitationStatus.REVOKED },
    });
    if (result.count === 0) {
      throw new ConflictException('Invitation is already revoked');
    }
    return { id: invitationId, status: InvitationStatus.REVOKED };
  }

  async validate(rawToken: string) {
    const tokenHash = this.hashTokenIfValid(rawToken);
    const invitation = this.getUsableInvitation(
      await this.prisma.invitationLink.findUnique({
        where: { tokenHash },
        select: invitationSelect,
      }),
      new Date(),
    );
    const capsule = invitation.capsule;

    return {
      capsule: {
        id: capsule.id,
        title: capsule.name,
        description: capsule.description,
        openingDate: capsule.opensAt,
        owner: capsule.owner,
      },
      expiresAt: invitation.expiresAt,
    };
  }

  async join(rawToken: string, userId: string) {
    const tokenHash = this.hashTokenIfValid(rawToken);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const invitation = this.getUsableInvitation(
            await tx.invitationLink.findUnique({
              where: { tokenHash },
              select: invitationSelect,
            }),
            now,
          );
          const capsule = invitation.capsule;

          if (capsule.ownerId === userId) {
            throw new ForbiddenException(
              'The capsule owner cannot join as a member',
            );
          }

          const existingMembership = await tx.capsuleMember.findUnique({
            where: {
              capsuleId_userId: {
                capsuleId: capsule.id,
                userId,
              },
            },
            select: { id: true },
          });
          if (existingMembership) {
            throw new ConflictException('User is already a capsule member');
          }

          const membership = await tx.capsuleMember.create({
            data: {
              capsuleId: capsule.id,
              userId,
              role: MemberRole.MEMBER,
            },
            select: { id: true, role: true, joinedAt: true },
          });
          const usage = await tx.invitationLink.updateMany({
            where: {
              id: invitation.id,
              status: InvitationStatus.ACTIVE,
              expiresAt: { gt: now },
              ...(invitation.maxUses === null
                ? {}
                : { usageCount: { lt: invitation.maxUses } }),
            },
            data: { usageCount: { increment: 1 } },
          });
          if (usage.count === 0) {
            throw new NotFoundException(INVALID_INVITATION_MESSAGE);
          }

          return {
            capsule: {
              id: capsule.id,
              title: capsule.name,
              openingDate: capsule.opensAt,
            },
            membership,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const code = this.getPrismaErrorCode(error);
      if (code === 'P2002') {
        throw new ConflictException('User is already a capsule member');
      }
      if (code === 'P2034') {
        throw new ConflictException(
          'Capsule or invitation changed; retry the request',
        );
      }
      throw error;
    }
  }

  private getUsableInvitation(
    invitation: InvitationRecord | null,
    now: Date,
  ): InvitationRecord & {
    capsule: NonNullable<InvitationRecord['capsule']>;
  } {
    if (
      !invitation ||
      invitation.status !== InvitationStatus.ACTIVE ||
      invitation.expiresAt <= now ||
      (invitation.maxUses !== null &&
        invitation.usageCount >= invitation.maxUses)
    ) {
      throw new NotFoundException(INVALID_INVITATION_MESSAGE);
    }

    const capsule = invitation.capsule;
    if (
      !capsule ||
      capsule.type !== CapsuleType.GROUP ||
      capsule.status !== CapsuleStatus.COLLECTING
    ) {
      throw new NotFoundException(INVALID_INVITATION_MESSAGE);
    }
    return { ...invitation, capsule };
  }

  private hashTokenIfValid(token: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new NotFoundException(INVALID_INVITATION_MESSAGE);
    }
    return this.hashToken(token);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
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
