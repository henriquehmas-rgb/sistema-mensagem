import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../queues/queues.constants';
import { KnowledgeGapsController } from './knowledge-gaps.controller';
import { KnowledgeGapsService } from './knowledge-gaps.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.AI_REPLY })],
  controllers: [KnowledgeGapsController],
  providers: [KnowledgeGapsService],
  exports: [KnowledgeGapsService],
})
export class KnowledgeGapsModule {}
