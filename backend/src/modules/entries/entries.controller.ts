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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { CreateEntryDto } from './dto/create-entry.dto';
import { QueryEntriesDto } from './dto/query-entries.dto';
import { UpdateEntryDto } from './dto/update-entry.dto';
import { EntriesService } from './entries.service';

@ApiTags('Entries')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Authentication required' })
@Controller('capsules/:capsuleId/entries')
export class EntriesController {
  constructor(private readonly entriesService: EntriesService) {}

  @Post()
  @ApiOperation({ summary: 'Create an entry in a capsule' })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiBody({ type: CreateEntryDto })
  @ApiResponse({
    status: 201,
    description: 'Entry created with author details',
    schema: {
      example: {
        id: '550e8400-e29b-41d4-a716-446655440003',
        text: 'A message to remember',
        capsuleId: '550e8400-e29b-41d4-a716-446655440001',
        author: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          username: 'jane',
          name: 'Jane Doe',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid text or restricted capsule',
  })
  @ApiResponse({
    status: 404,
    description: 'Capsule not found or inaccessible',
  })
  @ApiResponse({
    status: 403,
    description: 'Capsule membership is required to create entries',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Body() dto: CreateEntryDto,
  ) {
    return this.entriesService.create(capsuleId, user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List entries in a capsule chronologically' })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Paginated capsule entries',
    schema: {
      example: {
        items: [
          {
            id: '550e8400-e29b-41d4-a716-446655440003',
            text: 'A message to remember',
            capsuleId: '550e8400-e29b-41d4-a716-446655440001',
            author: {
              id: '550e8400-e29b-41d4-a716-446655440000',
              username: 'jane',
              name: 'Jane Doe',
            },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Capsule not found or inaccessible',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Query() query: QueryEntriesDto,
  ) {
    return this.entriesService.findAll(capsuleId, user.id, query);
  }

  @Get(':entryId')
  @ApiOperation({ summary: 'Get an entry by ID' })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Entry with safe author details',
    schema: {
      example: {
        id: '550e8400-e29b-41d4-a716-446655440003',
        text: 'A message to remember',
        capsuleId: '550e8400-e29b-41d4-a716-446655440001',
        author: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          username: 'jane',
          name: 'Jane Doe',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Capsule or entry not found' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return this.entriesService.findOne(capsuleId, entryId, user.id);
  }

  @Patch(':entryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an entry authored by the current user' })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiBody({ type: UpdateEntryDto })
  @ApiResponse({
    status: 200,
    description: 'Entry updated',
    schema: { example: { id: '550e8400-e29b-41d4-a716-446655440003' } },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid text or restricted capsule',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the entry author can update it',
  })
  @ApiResponse({ status: 404, description: 'Capsule or entry not found' })
  @ApiResponse({ status: 409, description: 'Entry changed concurrently' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: UpdateEntryDto,
  ) {
    return this.entriesService.update(capsuleId, entryId, user.id, dto);
  }

  @Delete(':entryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an entry authored by the current user' })
  @ApiParam({ name: 'capsuleId', format: 'uuid' })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Entry and attachment records deleted',
    schema: {
      example: {
        id: '550e8400-e29b-41d4-a716-446655440003',
        deleted: true,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Capsule is restricted' })
  @ApiResponse({
    status: 403,
    description: 'Only the entry author can delete it',
  })
  @ApiResponse({ status: 404, description: 'Capsule or entry not found' })
  @ApiResponse({ status: 409, description: 'Entry changed concurrently' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('capsuleId', ParseUUIDPipe) capsuleId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return this.entriesService.remove(capsuleId, entryId, user.id);
  }
}
