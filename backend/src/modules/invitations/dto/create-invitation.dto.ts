import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class CreateInvitationDto {
  @ApiPropertyOptional({
    minimum: 1,
    nullable: true,
    description: 'Maximum successful uses; null means unlimited.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === null ? null : Number(value)))
  @IsInt()
  @Min(1)
  maxUses: number | null = null;

  @ApiPropertyOptional({ default: 7, minimum: 1 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  expiresInDays = 7;
}
