import { ApiProperty } from '@nestjs/swagger';

export class InvitationCreatedResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    format: 'uri',
    description:
      'Contains the raw invitation token and is returned only at creation.',
  })
  invitationUrl!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}
