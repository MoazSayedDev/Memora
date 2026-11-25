import { ApiProperty } from '@nestjs/swagger';

export class AdminUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true })
  username!: string | null;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  isEmailVerified!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}
