import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationCreatedResponseDto } from './dto/invitation-created-response.dto';
import { InvitationEmailResponseDto } from './dto/invitation-email-response.dto';
import { InvitationJoinResponseDto } from './dto/invitation-join-response.dto';
import { InvitationListResponseDto } from './dto/invitation-list-response.dto';
import { InvitationPreviewResponseDto } from './dto/invitation-preview-response.dto';
import { InvitationRevokedResponseDto } from './dto/invitation-revoked-response.dto';
import {
  InvitationListStatus,
  ListInvitationsDto,
} from './dto/list-invitations.dto';
import { SendInvitationEmailDto } from './dto/send-invitation-email.dto';
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
      'Creates an invitation link. maxUses defaults to unlimited and expiresInDays defaults to seven.',
  })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiBody({ type: CreateInvitationDto, required: false })
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
    @Body() dto?: CreateInvitationDto,
  ) {
    return this.invitationsService.create(capsuleId, user.id, dto);
  }

  @Post('capsules/:capsuleId/invitations/email')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create and email a capsule invitation link' })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiBody({ type: SendInvitationEmailDto })
  @ApiResponse({
    status: 201,
    description: 'Invitation link emailed',
    type: InvitationEmailResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid email or capsule is ineligible',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the capsule owner can invite members',
  })
  @ApiResponse({ status: 404, description: 'Capsule not found' })
  async sendToEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Body() dto: SendInvitationEmailDto,
  ) {
    return this.invitationsService.sendToEmail(capsuleId, user.id, dto);
  }

  @Get('capsules/:capsuleId/invitations')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List invitation links for a GROUP capsule',
    description:
      'Returns invitation status and usage metadata. Raw invitation URLs are not stored and are only returned once at creation.',
  })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: InvitationListStatus })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Paginated invitation links',
    type: InvitationListResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Only the capsule owner can list invitations',
  })
  @ApiResponse({ status: 404, description: 'Capsule not found' })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Query() query: ListInvitationsDto,
  ) {
    return this.invitationsService.findAll(capsuleId, user.id, query);
  }

  @Post('capsules/:capsuleId/invitations/:invitationId/regenerate')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Regenerate an invitation link and revoke the previous link',
  })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiBody({ type: CreateInvitationDto, required: false })
  @ApiResponse({
    status: 201,
    description: 'New invitation created; previous link revoked',
    type: InvitationCreatedResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Only the capsule owner can regenerate invitations',
  })
  @ApiResponse({ status: 404, description: 'Capsule or invitation not found' })
  @ApiResponse({
    status: 409,
    description: 'Invitation is already revoked or changed',
  })
  async regenerate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body() dto?: CreateInvitationDto,
  ) {
    return this.invitationsService.regenerate(
      capsuleId,
      invitationId,
      user.id,
      dto,
    );
  }

  @Delete('capsules/:capsuleId/invitations')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke all active invitation links for a capsule' })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Active invitations revoked' })
  @ApiResponse({
    status: 403,
    description: 'Only the capsule owner can revoke invitations',
  })
  @ApiResponse({ status: 404, description: 'Capsule not found' })
  async revokeAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
  ) {
    return this.invitationsService.revokeAll(capsuleId, user.id);
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
