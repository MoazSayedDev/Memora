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
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CapsulesService } from './capsules.service';
import { CreateCapsuleDto } from './dto/create-capsule.dto';
import { ListCapsulesDto } from './dto/list-capsules.dto';
import { UpdateCapsuleDto } from './dto/update-capsule.dto';
import { UpdateCapsuleScheduleDto } from './dto/update-capsule-schedule.dto';
import { CapsuleLifecycleService } from './capsule-lifecycle.service';

@ApiTags('Capsules')
@ApiBearerAuth()
@Controller('capsules')
export class CapsulesController {
  constructor(
    private readonly capsulesService: CapsulesService,
    private readonly capsuleLifecycleService: CapsuleLifecycleService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a capsule' })
  @ApiResponse({ status: 201, description: 'Capsule created' })
  @ApiResponse({ status: 400, description: 'Invalid capsule data or opening date' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCapsuleDto,
  ) {
    return this.capsulesService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List capsules owned by or shared with the current user' })
  @ApiResponse({ status: 200, description: 'Paginated capsule list' })
  async findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListCapsulesDto,
  ) {
    return this.capsulesService.findMine(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get capsule metadata by ID' })
  @ApiResponse({ status: 200, description: 'Capsule metadata' })
  @ApiResponse({ status: 404, description: 'Capsule not found or inaccessible' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.capsulesService.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a capsule owned by the current user' })
  @ApiResponse({ status: 200, description: 'Capsule updated' })
  @ApiResponse({ status: 400, description: 'Invalid update or lifecycle state' })
  @ApiResponse({ status: 404, description: 'Capsule not found or inaccessible' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCapsuleDto,
  ) {
    return this.capsulesService.update(user.id, id, dto);
  }

  @Patch(':id/schedule')
  @ApiOperation({ summary: 'Update a capsule schedule' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateCapsuleScheduleDto })
  @ApiResponse({ status: 200, description: 'Capsule schedule updated' })
  @ApiResponse({
    status: 400,
    description: 'Invalid schedule or lifecycle state',
  })
  @ApiResponse({
    status: 404,
    description: 'Capsule not found or inaccessible',
  })
  async updateSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCapsuleScheduleDto,
  ) {
    return this.capsuleLifecycleService.updateSchedule(user.id, id, dto);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a collecting capsule immediately' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Capsule closed' })
  @ApiResponse({ status: 400, description: 'Capsule cannot be closed' })
  @ApiResponse({
    status: 404,
    description: 'Capsule not found or inaccessible',
  })
  async closeNow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.capsuleLifecycleService.closeNow(user.id, id);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a capsule owned by the current user' })
  @ApiResponse({ status: 200, description: 'Capsule cancelled or already cancelled' })
  @ApiResponse({ status: 400, description: 'Capsule cannot be cancelled' })
  @ApiResponse({ status: 404, description: 'Capsule not found or inaccessible' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.capsulesService.cancel(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Permanently delete an owned capsule without content' })
  @ApiResponse({ status: 200, description: 'Capsule deleted' })
  @ApiResponse({ status: 400, description: 'Capsule contains content or cannot be deleted safely' })
  @ApiResponse({ status: 404, description: 'Capsule not found or inaccessible' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.capsulesService.remove(user.id, id);
  }
}
