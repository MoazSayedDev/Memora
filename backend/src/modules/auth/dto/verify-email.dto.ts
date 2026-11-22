import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Email verification token from the email link' })
  @IsString()
  @MinLength(64)
  @MaxLength(64)
  token: string;
}
