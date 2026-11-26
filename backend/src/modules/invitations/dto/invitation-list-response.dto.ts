import { ApiProperty } from '@nestjs/swagger';
import { InvitationListStatus } from './list-invitations.dto';

export class InvitationListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: InvitationListStatus })
  status!: InvitationListStatus;

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
