import { IsEmail, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendVerificationDto {
  @ApiProperty({ example: 'user@memora.test' })
  @IsEmail()
  @MaxLength(254)
  email: string;
}
