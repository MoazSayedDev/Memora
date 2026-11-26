import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import { CreateInvitationDto } from './create-invitation.dto';

export class SendInvitationEmailDto extends CreateInvitationDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  email!: string;
}
