import { ApiProperty } from '@nestjs/swagger';
import { InvitationStatus } from '@prisma/client';

export class InvitationRevokedResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: InvitationStatus, example: InvitationStatus.REVOKED })
  status!: InvitationStatus;
}
