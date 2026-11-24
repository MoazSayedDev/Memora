import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteAccountDto {
  @ApiProperty({ description: 'The current account password' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
