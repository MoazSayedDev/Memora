import { ApiProperty } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';

export class CapsuleMemberResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  username!: string | null;

  @ApiProperty({ enum: MemberRole })
  role!: MemberRole;

  @ApiProperty({ format: 'date-time' })
  joinedAt!: Date;
}

export class CapsuleMembersPaginationDto {
  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  total!: number;

  @ApiProperty()
  totalPages!: number;
}

export class CapsuleMembersListResponseDto {
  @ApiProperty({ type: [CapsuleMemberResponseDto] })
  items!: CapsuleMemberResponseDto[];

  @ApiProperty({ type: CapsuleMembersPaginationDto })
  pagination!: CapsuleMembersPaginationDto;
}
