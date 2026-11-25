import { ApiProperty } from '@nestjs/swagger';
import { InvitationStatus } from '@prisma/client';

export class InvitationListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: InvitationStatus })
  status!: InvitationStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;

  @ApiProperty({ type: Number, nullable: true })
  maxUses!: number | null;

  @ApiProperty()
  usageCount!: number;
}

export class InvitationListPaginationDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class InvitationListResponseDto {
  @ApiProperty({ type: [InvitationListItemDto] })
  items!: InvitationListItemDto[];

  @ApiProperty({ type: InvitationListPaginationDto })
  pagination!: InvitationListPaginationDto;
}
