import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CapsuleStatus, CapsuleType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCapsuleDto } from './dto/create-capsule.dto';
import { ListCapsulesDto } from './dto/list-capsules.dto';
import { UpdateCapsuleDto } from './dto/update-capsule.dto';

const capsuleMetadataSelect = {
  id: true,
  ownerId: true,
  name: true,
  description: true,
  cover: true,
  type: true,
  opensAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CapsulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    dto: CreateCapsuleDto,
  ) {
    const openingDate = dto.openingDate ? new Date(dto.openingDate) : null;
    this.validateOpeningDate(openingDate);

    const status =
      dto.type === CapsuleType.PERSONAL
        ? CapsuleStatus.DRAFT
        : CapsuleStatus.COLLECTING;

    return this.prisma.$transaction(async (tx) => {
      const capsule = await tx.capsule.create({
        data: {
          ownerId: userId,
          name: dto.title,
          description: dto.description,
          cover: dto.cover,
          type: dto.type,
          opensAt: openingDate,
          status,
        },
        select: capsuleMetadataSelect,
      });

      await tx.capsuleMember.create({
        data: {
          capsuleId: capsule.id,
          userId,
          role: 'OWNER',
        },
      });

      return this.mapMetadata(capsule);
    });
  }

  async findMine(userId: string, query: ListCapsulesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.CapsuleWhereInput = {
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.capsule.findMany({
        where,
        select: capsuleMetadataSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.capsule.count({ where }),
    ]);

    return {
      items: items.map((capsule) => this.mapMetadata(capsule)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: string, capsuleId: string) {
    const capsule = await this.prisma.capsule.findFirst({
      where: {
        id: capsuleId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
      select: capsuleMetadataSelect,
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }
    return this.mapMetadata(capsule);
  }

  async update(
    userId: string,
    capsuleId: string,
    dto: UpdateCapsuleDto,
  ) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one capsule field is required');
    }

    const capsule = await this.prisma.capsule.findFirst({
      where: { id: capsuleId, ownerId: userId },
      select: { id: true, status: true },
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }
    if (capsule.status === CapsuleStatus.OPEN) {
      throw new BadRequestException('Opened capsules cannot be updated');
    }
    if (capsule.status === CapsuleStatus.CANCELLED) {
      throw new BadRequestException('Cancelled capsules cannot be updated');
    }

    let openingDate: Date | undefined;
    if (dto.openingDate !== undefined) {
      openingDate = new Date(dto.openingDate);
      this.validateOpeningDate(openingDate);
    }

    const data: Prisma.CapsuleUpdateManyMutationInput = {};
    if (dto.title !== undefined) data.name = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.type !== undefined) {
      data.type = dto.type;
      data.status =
        dto.type === CapsuleType.PERSONAL
          ? CapsuleStatus.DRAFT
          : CapsuleStatus.COLLECTING;
    }
    if (openingDate !== undefined) data.opensAt = openingDate;
    if (dto.cover !== undefined) data.cover = dto.cover;

    const result = await this.prisma.capsule.updateMany({
      where: {
        id: capsuleId,
        ownerId: userId,
        status: { in: [CapsuleStatus.DRAFT, CapsuleStatus.COLLECTING] },
      },
      data,
    });
    if (result.count === 0) {
      throw new BadRequestException(
        'Capsule lifecycle changed; refresh and try again',
      );
    }

    return this.findOwnedMetadata(capsuleId, userId);
  }

  async cancel(userId: string, capsuleId: string) {
    const capsule = await this.prisma.capsule.findFirst({
      where: { id: capsuleId, ownerId: userId },
      select: { id: true, status: true },
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }
    if (capsule.status === CapsuleStatus.CANCELLED) {
      return this.findOwnedMetadata(capsuleId, userId);
    }
    if (capsule.status === CapsuleStatus.OPEN) {
      throw new BadRequestException('Opened capsules cannot be cancelled');
    }

    const result = await this.prisma.capsule.updateMany({
      where: {
        id: capsuleId,
        ownerId: userId,
        status: { in: [CapsuleStatus.DRAFT, CapsuleStatus.COLLECTING] },
      },
      data: { status: CapsuleStatus.CANCELLED },
    });
    if (result.count === 0) {
      throw new BadRequestException(
        'Capsule lifecycle changed; refresh and try again',
      );
    }
    return this.findOwnedMetadata(capsuleId, userId);
  }

  async remove(userId: string, capsuleId: string) {
    return this.prisma.$transaction(async (tx) => {
      const capsule = await tx.capsule.findFirst({
        where: { id: capsuleId, ownerId: userId },
        select: {
          id: true,
          status: true,
          members: {
            select: {
              id: true,
              entries: {
                select: {
                  id: true,
                  attachments: { select: { id: true } },
                },
              },
            },
          },
          invitations: { select: { id: true } },
        },
      });
      if (!capsule) {
        throw new NotFoundException('Capsule not found');
      }
      if (capsule.status === CapsuleStatus.OPEN) {
        throw new BadRequestException('Opened capsules cannot be deleted');
      }

      const hasContent = capsule.members.some((member) =>
        member.entries.some(
          (entry) => entry.attachments.length > 0 || entry.id !== undefined,
        ),
      );
      if (hasContent) {
        throw new BadRequestException(
          'Capsules containing user-generated content cannot be deleted',
        );
      }

      await tx.invitationLink.deleteMany({
        where: { capsuleId: capsule.id },
      });
      await tx.capsuleMember.deleteMany({
        where: { capsuleId: capsule.id },
      });
      await tx.capsuleRemovedMember.deleteMany({
        where: { capsuleId: capsule.id },
      });
      await tx.capsule.delete({
        where: { id: capsule.id },
      });
      return { message: 'Capsule deleted successfully' };
    });
  }

  private async findOwnedMetadata(capsuleId: string, userId: string) {
    const capsule = await this.prisma.capsule.findFirst({
      where: { id: capsuleId, ownerId: userId },
      select: capsuleMetadataSelect,
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }
    return this.mapMetadata(capsule);
  }

  private validateOpeningDate(openingDate: Date | null) {
    if (openingDate !== null && (
      Number.isNaN(openingDate.getTime()) ||
      openingDate.getTime() <= Date.now()
    )) {
      throw new BadRequestException('Opening date must be in the future');
    }
  }

  private mapMetadata(capsule: {
    id: string;
    ownerId: string;
    name: string;
    description: string | null;
    cover: string | null;
    type: CapsuleType;
    opensAt: Date | null;
    status: CapsuleStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: capsule.id,
      ownerId: capsule.ownerId,
      title: capsule.name,
      description: capsule.description,
      cover: capsule.cover,
      type: capsule.type,
      openingDate: capsule.opensAt,
      status: capsule.status,
      createdAt: capsule.createdAt,
      updatedAt: capsule.updatedAt,
    };
  }
}
