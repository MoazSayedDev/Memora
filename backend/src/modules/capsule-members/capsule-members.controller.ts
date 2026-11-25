import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AddCapsuleMemberDto } from './dto/add-capsule-member.dto';
import {
  CapsuleMemberResponseDto,
  CapsuleMembersListResponseDto,
} from './dto/capsule-member-response.dto';
import { ListCapsuleMembersDto } from './dto/list-capsule-members.dto';
import { UpdateCapsuleMemberRoleDto } from './dto/update-capsule-member-role.dto';
import { CapsuleMembersService } from './capsule-members.service';

@ApiTags('Capsule Members')
@ApiBearerAuth()
@Controller('capsules/:capsuleId/members')
export class CapsuleMembersController {
  constructor(private readonly capsuleMembersService: CapsuleMembersService) {}

  @Post()
  @ApiOperation({ summary: 'Add a member to a GROUP capsule' })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiBody({ type: AddCapsuleMemberDto })
  @ApiResponse({
    status: 201,
    description: 'Member added',
    type: CapsuleMemberResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Capsule does not accept members or the owner was selected',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the capsule owner can add members',
  })
  @ApiResponse({ status: 404, description: 'Capsule or user not found' })
  @ApiResponse({
    status: 409,
    description: 'User is already a capsule member or capsule state changed',
  })
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Body() dto: AddCapsuleMemberDto,
  ) {
    return this.capsuleMembersService.add(capsuleId, user.id, dto.userId);
  }

  @Get()
  @ApiOperation({ summary: 'List capsule members' })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Paginated capsule members',
    type: CapsuleMembersListResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Capsule not found or inaccessible',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Query() query: ListCapsuleMembersDto,
  ) {
    return this.capsuleMembersService.findAll(capsuleId, user.id, query);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a capsule member or leave the capsule',
    description:
      'The owner can remove members; a member may remove only themselves.',
  })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Member removed' })
  @ApiResponse({
    status: 400,
    description:
      'Capsule does not accept membership changes or owner removal was attempted',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the owner may remove other members',
  })
  @ApiResponse({ status: 404, description: 'Capsule or membership not found' })
  @ApiResponse({ status: 409, description: 'Capsule state changed' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
  ) {
    return this.capsuleMembersService.remove(capsuleId, user.id, memberUserId);
  }

  @Patch(':userId/role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a capsule member role',
    description:
      'Only MEMBER may be assigned; OWNER promotion is not supported.',
  })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiBody({ type: UpdateCapsuleMemberRoleDto })
  @ApiResponse({
    status: 200,
    description: 'Member role updated',
    type: CapsuleMemberResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid role or capsule state' })
  @ApiResponse({
    status: 403,
    description: 'Only the capsule owner can manage roles',
  })
  @ApiResponse({ status: 404, description: 'Capsule or membership not found' })
  @ApiResponse({ status: 409, description: 'Capsule state changed' })
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
    @Body() dto: UpdateCapsuleMemberRoleDto,
  ) {
    return this.capsuleMembersService.updateRole(
      capsuleId,
      user.id,
      memberUserId,
      dto.role,
    );
  }
}
