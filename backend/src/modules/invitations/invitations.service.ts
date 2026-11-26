import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CapsuleStatus,
  CapsuleType,
  InvitationStatus,
  MemberRole,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { SendInvitationEmailDto } from './dto/send-invitation-email.dto';
import { ListInvitationsDto } from './dto/list-invitations.dto';
import { InvitationListStatus } from './dto/list-invitations.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRES_IN_DAYS = 7;
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
          email: true,
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
    owner: { name: string; username: string | null; email: string };
  } | null;
};

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async create(capsuleId: string, userId: string, dto?: CreateInvitationDto) {
    const rawToken = randomBytes(32).toString('base64url');
    const options = this.getInvitationOptions(dto);
    const invitation = await this.createInvitationRecord(
      capsuleId,
      userId,
      rawToken,
      options,
    );

    return {
      id: invitation.id,
      invitationUrl: this.buildInvitationUrl(rawToken),
      expiresAt: invitation.expiresAt,
    };
  }

  async sendToEmail(
    capsuleId: string,
    userId: string,
    dto: SendInvitationEmailDto,
  ) {
    const rawToken = randomBytes(32).toString('base64url');
    const invitation = await this.createInvitationRecord(
      capsuleId,
      userId,
      rawToken,
      this.getInvitationOptions(dto),
    );
    const invitationUrl = this.buildInvitationUrl(rawToken);

    try {
      await this.emailService.sendCapsuleInvitation(
        dto.email,
        invitation.capsuleName,
        invitationUrl,
      );
    } catch (error) {
      await this.prisma.invitationLink.updateMany({
        where: { id: invitation.id, status: InvitationStatus.ACTIVE },
        data: { status: InvitationStatus.REVOKED },
      });
      throw error;
    }

    return {
      id: invitation.id,
      email: dto.email,
      expiresAt: invitation.expiresAt,
    };
  }

  async regenerate(
    capsuleId: string,
    invitationId: string,
    userId: string,
    dto?: CreateInvitationDto,
  ) {
    const rawToken = randomBytes(32).toString('base64url');
    const options = this.getInvitationOptions(dto);
    try {
      const invitation = await this.prisma.$transaction(
        async (tx) => {
          await this.getOwnedInvitableCapsule(tx, capsuleId, userId);
          const previous = await tx.invitationLink.findFirst({
            where: { id: invitationId, capsuleId },
            select: { id: true, status: true },
          });
          if (!previous) {
            throw new NotFoundException('Invitation not found');
          }
          if (previous.status !== InvitationStatus.ACTIVE) {
            throw new ConflictException('Invitation is already revoked');
          }

          const revoked = await tx.invitationLink.updateMany({
            where: {
              id: invitationId,
              capsuleId,
              status: InvitationStatus.ACTIVE,
            },
            data: { status: InvitationStatus.REVOKED },
          });
          if (revoked.count === 0) {
            throw new ConflictException(
              'Invitation changed; retry the request',
            );
          }

          const replacement = await tx.invitationLink.create({
            data: {
              capsuleId,
              createdBy: userId,
              tokenHash: this.hashToken(rawToken),
              status: InvitationStatus.ACTIVE,
              expiresAt: options.expiresAt,
              maxUses: options.maxUses,
            },
            select: { id: true, expiresAt: true },
          });
          return replacement;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return {
        id: invitation.id,
        invitationUrl: this.buildInvitationUrl(rawToken),
        expiresAt: invitation.expiresAt,
      };
    } catch (error) {
      this.throwForTransactionError(error);
    }
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

    const now = new Date();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.InvitationLinkWhereInput = {
      capsuleId,
      ...(query.status === InvitationListStatus.REVOKED
        ? { status: InvitationStatus.REVOKED }
        : query.status === InvitationListStatus.EXPIRED
          ? {
              status: InvitationStatus.ACTIVE,
              expiresAt: { lte: now },
            }
          : query.status === InvitationListStatus.ACTIVE
            ? {
                status: InvitationStatus.ACTIVE,
                expiresAt: { gt: now },
              }
            : {}),
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
      items: invitations.map((invitation) => ({
        ...invitation,
        status:
          invitation.status === InvitationStatus.REVOKED
            ? InvitationListStatus.REVOKED
            : invitation.expiresAt <= now
              ? InvitationListStatus.EXPIRED
              : InvitationListStatus.ACTIVE,
      })),
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

  async revokeAll(capsuleId: string, userId: string) {
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

    const result = await this.prisma.invitationLink.updateMany({
      where: { capsuleId, status: InvitationStatus.ACTIVE },
      data: { status: InvitationStatus.REVOKED },
    });
    return { revokedCount: result.count };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredInvitations() {
    const retentionDays = Number(
      this.configService.getOrThrow<number>('INVITATION_RETENTION_DAYS'),
    );
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
    const result = await this.prisma.invitationLink.deleteMany({
      where: {
        status: InvitationStatus.ACTIVE,
        expiresAt: { lt: cutoff },
      },
    });
    return result.count;
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
        owner: {
          name: capsule.owner.name,
          username: capsule.owner.username,
        },
      },
      expiresAt: invitation.expiresAt,
    };
  }

  async join(rawToken: string, userId: string) {
    const tokenHash = this.hashTokenIfValid(rawToken);
    try {
      const joined = await this.prisma.$transaction(
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

          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { name: true, isEmailVerified: true },
          });
          if (!user) {
            throw new NotFoundException('User not found');
          }
          if (!user.isEmailVerified) {
            throw new ForbiddenException(
              'Verify your email before joining a capsule',
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

          const removedMember = await tx.capsuleRemovedMember.findUnique({
            where: {
              capsuleId_userId: {
                capsuleId: capsule.id,
                userId,
              },
            },
            select: { userId: true },
          });
          if (removedMember) {
            throw new ForbiddenException(
              'The capsule owner removed you from this capsule',
            );
          }

          const memberCount = await tx.capsuleMember.count({
            where: { capsuleId: capsule.id },
          });
          const maxMembers = Number(
            this.configService.getOrThrow<number>('MAX_CAPSULE_MEMBERS'),
          );
          if (memberCount >= maxMembers) {
            throw new ConflictException(
              'Capsule has reached the maximum member limit',
            );
          }

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

          const membership = await tx.capsuleMember.create({
            data: {
              capsuleId: capsule.id,
              userId,
              role: MemberRole.MEMBER,
            },
            select: { id: true, role: true, joinedAt: true },
          });

          return {
            response: {
              capsule: {
                id: capsule.id,
                title: capsule.name,
                openingDate: capsule.opensAt,
              },
              membership,
            },
            notification: {
              ownerEmail: capsule.owner.email,
              capsuleTitle: capsule.name,
              memberName: user.name,
            },
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      try {
        await this.emailService.sendCapsuleMemberJoined(
          joined.notification.ownerEmail,
          joined.notification.capsuleTitle,
          joined.notification.memberName,
        );
      } catch (error) {
        this.logger.error(
          'Capsule member joined, but owner notification could not be sent',
          error instanceof Error ? error.stack : String(error),
        );
      }
      return joined.response;
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

  private getInvitationOptions(dto?: CreateInvitationDto) {
    const expiresInDays = dto?.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
    const expiresAt = new Date(Date.now() + expiresInDays * DAY_MS);
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new BadRequestException('Invitation expiry is invalid');
    }
    return {
      expiresAt,
      maxUses: dto?.maxUses ?? null,
    };
  }

  private async createInvitationRecord(
    capsuleId: string,
    userId: string,
    rawToken: string,
    options: { expiresAt: Date; maxUses: number | null },
  ) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const capsule = await this.getOwnedInvitableCapsule(
            tx,
            capsuleId,
            userId,
          );
          const invitation = await tx.invitationLink.create({
            data: {
              capsuleId,
              createdBy: userId,
              tokenHash: this.hashToken(rawToken),
              status: InvitationStatus.ACTIVE,
              expiresAt: options.expiresAt,
              maxUses: options.maxUses,
            },
            select: { id: true, expiresAt: true },
          });
          return { ...invitation, capsuleName: capsule.name };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.throwForTransactionError(error);
    }
  }

  private async getOwnedInvitableCapsule(
    tx: Prisma.TransactionClient,
    capsuleId: string,
    userId: string,
  ) {
    const capsule = await tx.capsule.findUnique({
      where: { id: capsuleId },
      select: { id: true, ownerId: true, type: true, status: true, name: true },
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }
    if (capsule.ownerId !== userId) {
      throw new ForbiddenException(
        'Only the capsule owner can manage invitations',
      );
    }
    if (capsule.type !== CapsuleType.GROUP) {
      throw new BadRequestException('Only GROUP capsules support invitations');
    }
    if (capsule.status !== CapsuleStatus.COLLECTING) {
      throw new BadRequestException(
        'Invitations can only be created for collecting capsules',
      );
    }
    return capsule;
  }

  private buildInvitationUrl(rawToken: string): string {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    return new URL(
      `invitations/${rawToken}`,
      `${frontendUrl.replace(/\/+$/, '')}/`,
    ).toString();
  }

  private throwForTransactionError(error: unknown): never {
    if (this.getPrismaErrorCode(error) === 'P2034') {
      throw new ConflictException(
        'Capsule or invitation changed; refresh and try again',
      );
    }
    throw error;
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
