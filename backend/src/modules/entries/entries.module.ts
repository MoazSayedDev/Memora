import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';

@Module({
  imports: [PrismaModule, AttachmentsModule],
  controllers: [EntriesController],
  providers: [EntriesService],
})
export class EntriesModule {}
