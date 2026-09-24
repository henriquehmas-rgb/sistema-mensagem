import { Module } from '@nestjs/common';
import { IxcCatalogRefreshModule } from '../integrations/ixc/ixc-catalog-refresh.module';
import { QueueModule } from '../queues/queue.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [QueueModule, IxcCatalogRefreshModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
})
export class KnowledgeModule {}
