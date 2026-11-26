import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CapsuleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEntryDto } from './dto/create-entry.dto';
import { QueryEntriesDto } from './dto/query-entries.dto';
import { UpdateEntryDto } from './dto/update-entry.dto';

const entrySelect = {
  id: true,
  text: true,
  createdAt: true,
  updatedAt: true,
  capsuleMember: {
    select: {
      capsuleId: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  },
} as const;

type PrismaReader = Pick<Prisma.TransactionClient, 'capsule'>;

@Injectable()
export class EntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(capsuleId: string, userId: string, dto: CreateEntryDto) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const capsule = await this.findAccessibleCapsule(
            tx,
            capsuleId,
            userId,
          );
          this.assertWritable(capsule.status);

          const membership = capsule.members[0];
          if (!membership) {
            throw new ForbiddenException(
              'A capsule membership is required to create entries',
            );
          }

          const entry = await tx.capsuleEntry.create({
            data: {
              capsuleMemberId: membership.id,
              text: dto.text,
            },
            select: entrySelect,
          });
          return this.mapEntry(entry);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.throwForPrismaMutationError(error);
    }
  }

  async findAll(capsuleId: string, userId: string, query: QueryEntriesDto) {
    await this.findAccessibleCapsule(this.prisma, capsuleId, userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.CapsuleEntryWhereInput = {
      capsuleMember: { is: { capsuleId } },
    };
    const [entries, total] = await this.prisma.$transaction([
      this.prisma.capsuleEntry.findMany({
        where,
        select: entrySelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.capsuleEntry.count({ where }),
    ]);

    return {
      items: entries.map((entry) => this.mapEntry(entry)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(capsuleId: string, entryId: string, userId: string) {
    await this.findAccessibleCapsule(this.prisma, capsuleId, userId);

    const entry = await this.prisma.capsuleEntry.findFirst({
      where: {
        id: entryId,
        capsuleMember: { is: { capsuleId } },
      },
      select: entrySelect,
    });
    if (!entry) {
      throw new NotFoundException('Entry not found');
    }
    return this.mapEntry(entry);
  }

  async update(
    capsuleId: string,
    entryId: string,
    userId: string,
    dto: UpdateEntryDto,
  ) {
    if (dto.text === undefined) {
      throw new BadRequestException('Entry text is required');
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const capsule = await this.findAccessibleCapsule(
            tx,
            capsuleId,
            userId,
          );
          this.assertWritable(capsule.status);
          const entry = await this.findEntryForMutation(tx, capsuleId, entryId);
          this.assertAuthor(entry.capsuleMember.userId, userId);

          const result = await tx.capsuleEntry.updateMany({
            where: {
              id: entryId,
              capsuleMemberId: entry.capsuleMemberId,
            },
            data: { text: dto.text },
          });
          if (result.count === 0) {
            throw new ConflictException('Entry changed; refresh and try again');
          }

          const updated = await tx.capsuleEntry.findUniqueOrThrow({
            where: { id: entryId },
            select: entrySelect,
          });
          return this.mapEntry(updated);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.throwForPrismaMutationError(error);
    }
  }

  async remove(capsuleId: string, entryId: string, userId: string) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const capsule = await this.findAccessibleCapsule(
            tx,
            capsuleId,
            userId,
          );
          this.assertWritable(capsule.status);
          const entry = await this.findEntryForMutation(tx, capsuleId, entryId);
          this.assertAuthor(entry.capsuleMember.userId, userId);

          await tx.entryAttachment.deleteMany({ where: { entryId } });
          const result = await tx.capsuleEntry.deleteMany({
            where: {
              id: entryId,
              capsuleMemberId: entry.capsuleMemberId,
            },
          });
          if (result.count === 0) {
            throw new ConflictException('Entry changed; refresh and try again');
          }
          return { id: entryId, deleted: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.throwForPrismaMutationError(error);
    }
  }

  private async findAccessibleCapsule(
    client: PrismaReader,
    capsuleId: string,
    userId: string,
  ) {
    const capsule = await client.capsule.findFirst({
      where: {
        id: capsuleId,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      select: {
        id: true,
        status: true,
        members: {
          where: { userId },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }
    return capsule;
  }

  private async findEntryForMutation(
    tx: Prisma.TransactionClient,
    capsuleId: string,
    entryId: string,
  ) {
    const entry = await tx.capsuleEntry.findFirst({
      where: {
        id: entryId,
        capsuleMember: { is: { capsuleId } },
      },
      select: {
        id: true,
        capsuleMemberId: true,
        capsuleMember: { select: { userId: true } },
      },
    });
    if (!entry) {
      throw new NotFoundException('Entry not found');
    }
    return entry;
  }

  private assertWritable(status: CapsuleStatus) {
    if (status !== CapsuleStatus.DRAFT && status !== CapsuleStatus.COLLECTING) {
      throw new BadRequestException(
        'Entries cannot be changed in this capsule state',
      );
    }
  }

  private assertAuthor(authorId: string, userId: string) {
    if (authorId !== userId) {
      throw new ForbiddenException('Only the entry author can modify it');
    }
  }

  private mapEntry(entry: {
    id: string;
    text: string | null;
    createdAt: Date;
    updatedAt: Date;
    capsuleMember: {
      capsuleId: string;
      userId: string;
      user: { id: string; name: string; username: string | null };
    };
  }) {
    return {
      id: entry.id,
      text: entry.text,
      capsuleId: entry.capsuleMember.capsuleId,
      author: {
        id: entry.capsuleMember.user.id,
        username: entry.capsuleMember.user.username,
        name: entry.capsuleMember.user.name,
      },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private throwForPrismaMutationError(error: unknown): never {
    const code = this.getPrismaErrorCode(error);
    if (code === 'P2034') {
      throw new ConflictException(
        'Capsule or entry changed; refresh and try again',
      );
    }
    if (code === 'P2003' || code === 'P2025') {
      throw new NotFoundException('Capsule or entry no longer exists');
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
