import { ApiPropertyOptional } from '@nestjs/swagger';
import { CapsuleStatus, CapsuleType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListCapsulesDto {
  @ApiPropertyOptional({ enum: CapsuleStatus })
  @IsOptional()
  @IsEnum(CapsuleStatus)
  status?: CapsuleStatus;

  @ApiPropertyOptional({ enum: CapsuleType })
  @IsOptional()
  @IsEnum(CapsuleType)
  type?: CapsuleType;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
