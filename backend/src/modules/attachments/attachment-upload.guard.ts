import {
  CanActivate,
  BadRequestException,
  ExecutionContext,
  Injectable,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AttachmentsService } from './attachments.service';

type AuthenticatedRequest = {
  params: { entryId?: string };
  user: AuthenticatedUser;
};

@Injectable()
export class AttachmentUploadGuard implements CanActivate {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawEntryId = request.params.entryId;
    if (!rawEntryId) {
      throw new BadRequestException('Entry ID is required');
    }
    const entryId = await new ParseUUIDPipe().transform(rawEntryId, {
      type: 'param',
      data: 'entryId',
      metatype: String,
    });
    await this.attachmentsService.assertCanUpload(entryId, request.user.id);
    return true;
  }
}
