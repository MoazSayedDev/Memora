import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AttachmentsService } from './attachments.service';
import { AttachmentUploadGuard } from './attachment-upload.guard';
import { MAX_FILES_PER_UPLOAD } from './file-validation';

@ApiTags('Attachments')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Authentication required' })
@Controller()
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('entries/:entryId/attachments')
  @UseGuards(AttachmentUploadGuard)
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_UPLOAD))
  @ApiOperation({ summary: 'Upload attachments to an entry' })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Attachment metadata' })
  @ApiResponse({ status: 400, description: 'Invalid or oversized attachment' })
  @ApiResponse({
    status: 403,
    description: 'Entry is not writable by the current user',
  })
  @ApiResponse({ status: 404, description: 'Entry not found or inaccessible' })
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.attachmentsService.upload(entryId, user.id, files ?? []);
  }

  @Get('entries/:entryId/attachments')
  @ApiOperation({ summary: 'List attachments belonging to an entry' })
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Attachment metadata list' })
  @ApiResponse({ status: 404, description: 'Entry not found or inaccessible' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return this.attachmentsService.findAll(entryId, user.id);
  }

  @Get('attachments/:attachmentId')
  @ApiOperation({ summary: 'Get attachment metadata' })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Safe attachment metadata' })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.attachmentsService.findOne(attachmentId, user.id);
  }

  @Get('attachments/:attachmentId/download')
  @ApiOperation({ summary: 'Download an attachment' })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Attachment file' })
  @ApiResponse({ status: 404, description: 'Attachment or file not found' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.attachmentsService.getDownload(
      attachmentId,
      user.id,
    );
    const filename = this.encodeFilename(result.attachment.originalName);
    response.setHeader('Content-Disposition', `attachment; ${filename}`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(result.stream, {
      type: result.attachment.mimeType,
    });
  }

  @Delete('attachments/:attachmentId')
  @ApiOperation({
    summary:
      'Delete an attachment uploaded by the current user or capsule owner',
  })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Attachment deleted' })
  @ApiResponse({ status: 400, description: 'Capsule content is read-only' })
  @ApiResponse({
    status: 403,
    description: 'Only the uploader or capsule owner can delete the attachment',
  })
  @ApiResponse({ status: 404, description: 'Attachment not found' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.attachmentsService.remove(attachmentId, user.id);
  }

  private encodeFilename(originalName: string | null) {
    const safeName = (originalName ?? 'attachment')
      .replace(/[\u0000-\u001f\u007f"\\]/g, '_')
      .replace(/[^\x20-\x7e]/g, '_');
    const encodedName = encodeURIComponent(originalName ?? 'attachment');
    return `filename="${safeName}"; filename*=UTF-8''${encodedName}`;
  }
}
