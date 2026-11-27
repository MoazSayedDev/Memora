import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CapsulesController } from './capsules.controller';
import { CapsulesService } from './capsules.service';
import { CapsuleLifecycleEvents } from './capsule-lifecycle-events';
import { CapsuleLifecycleService } from './capsule-lifecycle.service';

@Module({
  imports: [PrismaModule],
  controllers: [CapsulesController],
  providers: [CapsulesService, CapsuleLifecycleEvents, CapsuleLifecycleService],
  exports: [CapsulesService, CapsuleLifecycleService, CapsuleLifecycleEvents],
})
export class CapsulesModule {}
