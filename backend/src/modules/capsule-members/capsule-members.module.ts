import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CapsuleMembersController } from './capsule-members.controller';
import { CapsuleMembersService } from './capsule-members.service';

@Module({
  imports: [PrismaModule],
  controllers: [CapsuleMembersController],
  providers: [CapsuleMembersService],
})
export class CapsuleMembersModule {}
