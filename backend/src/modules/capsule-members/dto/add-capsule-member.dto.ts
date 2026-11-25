import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddCapsuleMemberDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;
}
