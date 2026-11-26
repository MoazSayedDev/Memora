import { ApiProperty } from '@nestjs/swagger';

export class InvitationEmailResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}
