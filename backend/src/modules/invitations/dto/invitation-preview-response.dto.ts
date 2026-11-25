import { ApiProperty } from '@nestjs/swagger';

export class InvitationOwnerPreviewDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  username!: string | null;
}

export class InvitationCapsulePreviewDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  openingDate!: Date | null;

  @ApiProperty({ type: InvitationOwnerPreviewDto })
  owner!: InvitationOwnerPreviewDto;
}

export class InvitationPreviewResponseDto {
  @ApiProperty({ type: InvitationCapsulePreviewDto })
  capsule!: InvitationCapsulePreviewDto;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}
