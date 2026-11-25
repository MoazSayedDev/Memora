import { ApiProperty } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';

export class InvitationJoinCapsuleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  openingDate!: Date | null;
}

export class InvitationMembershipDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: MemberRole, example: MemberRole.MEMBER })
  role!: MemberRole;

  @ApiProperty({ format: 'date-time' })
  joinedAt!: Date;
}

export class InvitationJoinResponseDto {
  @ApiProperty({ type: InvitationJoinCapsuleDto })
  capsule!: InvitationJoinCapsuleDto;

  @ApiProperty({ type: InvitationMembershipDto })
  membership!: InvitationMembershipDto;
}
