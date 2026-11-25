import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { InvitationCreatedResponseDto } from './dto/invitation-created-response.dto';
import { InvitationJoinResponseDto } from './dto/invitation-join-response.dto';
import { InvitationPreviewResponseDto } from './dto/invitation-preview-response.dto';
import { InvitationRevokedResponseDto } from './dto/invitation-revoked-response.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('Invitations')
@Controller()
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('capsules/:capsuleId/invitations')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create a GROUP capsule invitation link',
    description:
      'Creates an independent seven-day invitation link. Multiple active links per capsule are allowed.',
  })
  @ApiResponse({
    status: 201,
    description: 'Invitation link created',
    type: InvitationCreatedResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Capsule is not eligible for invitations',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the capsule owner can invite members',
  })
  @ApiResponse({ status: 404, description: 'Capsule not found' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
  ) {
    return this.invitationsService.create(capsuleId, user.id);
  }

  @Delete('capsules/:capsuleId/invitations/:invitationId')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an active capsule invitation link' })
  @ApiResponse({
    status: 200,
    description: 'Invitation revoked',
    type: InvitationRevokedResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Only the capsule owner can revoke invitations',
  })
  @ApiResponse({ status: 404, description: 'Capsule or invitation not found' })
  @ApiResponse({ status: 409, description: 'Invitation is already revoked' })
  async revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.revoke(capsuleId, invitationId, user.id);
  }

  @Get('invitations/:token')
  @Public()
  @ApiOperation({
    summary: 'Preview an invitation',
    description:
      'Public, read-only preview for invite recipients before sign-in. Returns metadata only; joining requires authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Safe capsule preview',
    type: InvitationPreviewResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Invitation not found or unavailable',
  })
  async validate(
    @Param('token') token: string,
  ): Promise<InvitationPreviewResponseDto> {
    return this.invitationsService.validate(token);
  }

  @Post('invitations/:token/join')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Join a GROUP capsule using an invitation',
    description:
      'Requires an authenticated user and creates a MEMBER membership.',
  })
  @ApiResponse({
    status: 201,
    description: 'Joined capsule',
    type: InvitationJoinResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Capsule owner cannot join as a member',
  })
  @ApiResponse({
    status: 404,
    description: 'Invitation not found or unavailable',
  })
  @ApiResponse({
    status: 409,
    description: 'User is already a member or state changed',
  })
  async join(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    return this.invitationsService.join(token, user.id);
  }
}
