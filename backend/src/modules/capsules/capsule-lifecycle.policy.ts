import { BadRequestException } from '@nestjs/common';
import { CapsuleStatus } from '@prisma/client';

export function assertCapsuleAcceptsContent(status: CapsuleStatus) {
  if (status !== CapsuleStatus.DRAFT && status !== CapsuleStatus.COLLECTING) {
    throw new BadRequestException(
      'Capsule content cannot be changed in this lifecycle state',
    );
  }
}
