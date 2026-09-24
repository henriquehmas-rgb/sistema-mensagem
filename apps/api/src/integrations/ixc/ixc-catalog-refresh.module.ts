import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IxcSalesCatalogRefreshService } from '../../knowledge/ixc-sales-catalog-refresh.service';
import { QueueModule } from '../../queues/queue.module';
import { QUEUES } from '../../queues/queues.constants';
import { IxcModule } from './ixc.module';
import { IxcCatalogRefreshProcessor } from './ixc-catalog-refresh.processor';
import { IxcCatalogRefreshScheduler } from './ixc-catalog-refresh.scheduler';

/** Ponte IXC factual com renovação periódica; separada da aprendizagem. */
@Module({
  imports: [IxcModule, QueueModule, BullModule.registerQueue({ name: QUEUES.IXC_CATALOG_REFRESH })],
  providers: [IxcSalesCatalogRefreshService, IxcCatalogRefreshProcessor, IxcCatalogRefreshScheduler],
  exports: [IxcSalesCatalogRefreshService],
})
export class IxcCatalogRefreshModule {}
