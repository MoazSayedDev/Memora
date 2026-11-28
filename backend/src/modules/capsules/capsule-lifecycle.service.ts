import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CapsuleStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { UpdateCapsuleScheduleDto } from './dto/update-capsule-schedule.dto';
import { CapsulesService } from './capsules.service';
import { CapsuleLifecycleEvents } from './capsule-lifecycle-events';

@Injectable()
export class CapsuleLifecycleService {
  private readonly logger = new Logger(CapsuleLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capsulesService: CapsulesService,
    private readonly lifecycleEvents: CapsuleLifecycleEvents,
    private readonly emailService: EmailService,
  ) {}

  async updateSchedule(
    userId: string,
    capsuleId: string,
    dto: UpdateCapsuleScheduleDto,
  ) {
    const capsule = await this.prisma.capsule.findFirst({
      where: { id: capsuleId, ownerId: userId },
      select: {
        id: true,
        status: true,
        opensAt: true,
        closeAt: true,
      },
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }

    const requestedOpenAt = this.resolveOpenAt(dto.openAt, dto.openingDate);
    const openAtWasProvided =
      dto.openAt !== undefined || dto.openingDate !== undefined;
    if (!openAtWasProvided && dto.closeAt === undefined) {
      throw new BadRequestException('At least one schedule date is required');
    }

    if (capsule.status === CapsuleStatus.CANCELLED) {
      throw new BadRequestException('Cancelled capsules cannot be scheduled');
    }
    if (capsule.status === CapsuleStatus.OPEN) {
      throw new BadRequestException('Opened capsules cannot be rescheduled');
    }

    const closed = capsule.status === CapsuleStatus.CLOSED;
    if (closed && dto.closeAt !== undefined) {
      throw new BadRequestException(
        'The closing date cannot be changed after a capsule is closed',
      );
    }

    const nextOpenAt = openAtWasProvided
      ? this.parseOptionalDate(requestedOpenAt, 'Opening')
      : capsule.opensAt;
    const nextCloseAt = closed
      ? capsule.closeAt
      : dto.closeAt === undefined
        ? capsule.closeAt
        : this.parseOptionalDate(dto.closeAt, 'Closing');

    if (closed) {
      if (!openAtWasProvided || !nextOpenAt) {
        throw new BadRequestException(
          'A future opening date is required for a closed capsule',
        );
      }
      this.assertFuture(nextOpenAt, 'Opening');
      if (nextCloseAt && nextOpenAt.getTime() <= nextCloseAt.getTime()) {
        throw new BadRequestException('openAt must be later than closeAt');
      }
    } else {
      if (nextOpenAt) this.assertFuture(nextOpenAt, 'Opening');
      if (nextCloseAt) this.assertFuture(nextCloseAt, 'Closing');
      if (nextCloseAt && !nextOpenAt) {
        throw new BadRequestException(
          'An opening date is required when a closing date is configured',
        );
      }
      if (
        nextCloseAt &&
        nextOpenAt &&
        nextOpenAt.getTime() <= nextCloseAt.getTime()
      ) {
        throw new BadRequestException('openAt must be later than closeAt');
      }
    }

    const scheduledStatus =
      capsule.status === CapsuleStatus.DRAFT && (nextOpenAt || nextCloseAt)
        ? CapsuleStatus.COLLECTING
        : capsule.status;
    const result = await this.prisma.capsule.updateMany({
      where: {
        id: capsuleId,
        ownerId: userId,
        status: capsule.status,
      },
      data: {
        ...(scheduledStatus !== capsule.status
          ? { status: scheduledStatus }
          : {}),
        ...(openAtWasProvided ? { opensAt: nextOpenAt } : {}),
        ...(!closed && dto.closeAt !== undefined
          ? { closeAt: nextCloseAt }
          : {}),
      },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'Capsule lifecycle changed; refresh and try again',
      );
    }
    return this.capsulesService.findOne(userId, capsuleId);
  }

  async closeNow(userId: string, capsuleId: string) {
    const capsule = await this.prisma.capsule.findFirst({
      where: { id: capsuleId, ownerId: userId },
      select: { id: true, status: true, opensAt: true },
    });
    if (!capsule) {
      throw new NotFoundException('Capsule not found');
    }
    if (capsule.status === CapsuleStatus.CLOSED) {
      return this.capsulesService.findOne(userId, capsuleId);
    }
    if (capsule.status !== CapsuleStatus.COLLECTING) {
      throw new BadRequestException(
        'Only collecting capsules can be closed manually',
      );
    }
    if (!capsule.opensAt) {
      throw new BadRequestException(
        'Configure a future opening date before closing the capsule',
      );
    }

    const now = new Date();
    this.assertFuture(capsule.opensAt, 'Opening');
    const result = await this.prisma.capsule.updateMany({
      where: {
        id: capsuleId,
        ownerId: userId,
        status: CapsuleStatus.COLLECTING,
        opensAt: { gt: now },
      },
      data: {
        status: CapsuleStatus.CLOSED,
        closedAt: now,
      },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'Capsule lifecycle changed; refresh and try again',
      );
    }

    this.lifecycleEvents.capsuleClosed(capsuleId, now);
    this.logger.log(`Manually closed capsule ${capsuleId}`);
    return this.capsulesService.findOne(userId, capsuleId);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueCapsules() {
    const now = new Date();
    await this.closeDueCapsules(now);
    await this.openDueCapsules(now);
  }

  private async closeDueCapsules(now: Date) {
    try {
      const dueCapsules = await this.prisma.capsule.findMany({
        where: {
          status: CapsuleStatus.COLLECTING,
          closeAt: { lte: now },
          opensAt: { not: null },
        },
        select: { id: true },
      });

      for (const capsule of dueCapsules) {
        try {
          const result = await this.prisma.capsule.updateMany({
            where: {
              id: capsule.id,
              status: CapsuleStatus.COLLECTING,
              closeAt: { lte: now },
              opensAt: { not: null },
            },
            data: {
              status: CapsuleStatus.CLOSED,
              closedAt: now,
            },
          });
          if (result.count === 1) {
            this.lifecycleEvents.capsuleClosed(capsule.id, now);
            this.logger.log(`Automatically closed capsule ${capsule.id}`);
          }
        } catch (error) {
          this.logger.error(
            `Failed to close capsule ${capsule.id}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to find capsules due for closing',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async openDueCapsules(now: Date) {
    try {
      const dueCapsules = await this.prisma.capsule.findMany({
        where: {
          OR: [
            {
              status: CapsuleStatus.CLOSED,
              opensAt: { lte: now },
            },
            {
              status: { in: [CapsuleStatus.DRAFT, CapsuleStatus.COLLECTING] },
              closeAt: null,
              opensAt: { lte: now },
            },
          ],
        },
        select: { id: true, status: true },
      });

      for (const capsule of dueCapsules) {
        try {
          const result = await this.prisma.capsule.updateMany({
            where: {
              id: capsule.id,
              status: capsule.status,
              ...(capsule.status !== CapsuleStatus.CLOSED
                ? { closeAt: null, opensAt: { lte: now } }
                : { opensAt: { lte: now } }),
            },
            data: {
              status: CapsuleStatus.OPEN,
              openedAt: now,
            },
          });
          if (result.count === 1) {
            this.lifecycleEvents.capsuleOpened(capsule.id, now);
            this.logger.log(`Automatically opened capsule ${capsule.id}`);
            await this.notifyCapsuleMembers(capsule.id);
          }
        } catch (error) {
          this.logger.error(
            `Failed to open capsule ${capsule.id}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to find capsules due for opening',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async notifyCapsuleMembers(capsuleId: string) {
    try {
      const capsule = await this.prisma.capsule.findUnique({
        where: { id: capsuleId },
        select: {
          name: true,
          members: { select: { user: { select: { email: true } } } },
        },
      });
      if (!capsule) {
        throw new Error(`Opened capsule ${capsuleId} could not be found`);
      }

      const results = await Promise.allSettled(
        capsule.members.map(({ user }) =>
          this.emailService.sendCapsuleOpened(user.email, capsule.name),
        ),
      );
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          this.logger.error(
            `Failed to send capsule-opened email for capsule ${capsuleId} to member ${index + 1}`,
            result.reason instanceof Error
              ? result.reason.stack
              : String(result.reason),
          );
        }
      });
    } catch (error) {
      this.logger.error(
        `Failed to notify members that capsule ${capsuleId} opened`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private resolveOpenAt(openAt?: string | null, openingDate?: string | null) {
    if (
      openAt !== undefined &&
      openingDate !== undefined &&
      (openAt === null
        ? openingDate !== null
        : openingDate === null ||
          this.parseDate(openAt, 'Opening').getTime() !==
            this.parseDate(openingDate, 'Opening').getTime())
    ) {
      throw new BadRequestException(
        'openAt and openingDate must have the same value',
      );
    }
    return openAt !== undefined ? openAt : openingDate;
  }

  private parseDate(value: string | null | undefined, label: string) {
    if (value === undefined || value === null) {
      throw new BadRequestException(`${label} date cannot be empty`);
    }
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      throw new BadRequestException(`${label} date must include a timezone`);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label} date is invalid`);
    }
    return date;
  }

  private parseOptionalDate(value: string | null | undefined, label: string) {
    return value === null ? null : this.parseDate(value, label);
  }

  private assertFuture(date: Date, label: string) {
    if (date.getTime() <= Date.now()) {
      throw new BadRequestException(`${label} date must be in the future`);
    }
  }
}
