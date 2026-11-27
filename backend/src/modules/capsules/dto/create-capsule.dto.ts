import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CapsuleType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCapsuleDto {
  @ApiProperty({ example: 'Summer Memories', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @ApiPropertyOptional({
    example: 'Photos and messages for summer',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: CapsuleType, example: CapsuleType.PERSONAL })
  @IsEnum(CapsuleType)
  type: CapsuleType;

  @ApiPropertyOptional({
    example: '2027-01-01T12:00:00.000Z',
    description: 'Legacy alias for openAt',
  })
  @IsOptional()
  @IsDateString()
  openingDate?: string;

  @ApiPropertyOptional({
    example: '2027-01-01T12:00:00.000Z',
    description: 'Future date and time at which the capsule opens',
  })
  @IsOptional()
  @IsDateString()
  openAt?: string;

  @ApiPropertyOptional({
    example: '2026-12-01T12:00:00.000Z',
    description: 'Future date and time at which the capsule closes',
  })
  @IsOptional()
  @IsDateString()
  closeAt?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/cover.jpg',
    maxLength: 2048,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cover?: string;
}
