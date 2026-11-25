import { ApiProperty } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateCapsuleMemberRoleDto {
  @ApiProperty({ enum: MemberRole, example: MemberRole.MEMBER })
  @IsEnum(MemberRole)
  role!: MemberRole;
}
