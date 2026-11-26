import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

function trimText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreateEntryDto {
  @ApiProperty({
    example: 'A message to remember',
    minLength: 1,
    maxLength: 5000,
  })
  @Transform(({ value }) => trimText(value as unknown))
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text: string;
}
