import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class UpdateCapsuleScheduleDto {
  @ApiPropertyOptional({
    example: '2026-12-01T12:00:00.000Z',
    nullable: true,
    description: 'Future closing date, or null to remove the closing schedule',
  })
  @IsOptional()
  @IsDateString()
  closeAt?: string | null;

  @ApiPropertyOptional({
    example: '2027-01-01T12:00:00.000Z',
    nullable: true,
    description: 'Future opening date, or null to remove the opening schedule',
  })
  @IsOptional()
  @IsDateString()
  openAt?: string | null;

  @ApiPropertyOptional({
    example: '2027-01-01T12:00:00.000Z',
    deprecated: true,
    description: 'Compatibility alias for openAt',
  })
  @IsOptional()
  @IsDateString()
  openingDate?: string | null;
}
