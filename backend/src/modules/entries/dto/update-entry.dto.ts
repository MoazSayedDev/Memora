import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateEntryDto {
  @ApiPropertyOptional({
    example: 'An updated message to remember',
    minLength: 1,
    maxLength: 5000,
  })
  @Transform(({ value }) => trimText(value as unknown))
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text?: string;
}
