import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { IxcSalesCatalogRefreshService } from '../../knowledge/ixc-sales-catalog-refresh.service';
import { QUEUES, type IxcCatalogRefreshJob } from '../../queues/queues.constants';

@Processor(QUEUES.IXC_CATALOG_REFRESH)
export class IxcCatalogRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(IxcCatalogRefreshProcessor.name);

  constructor(private readonly catalog: IxcSalesCatalogRefreshService) {
    super();
  }

  async process(_job: Job<IxcCatalogRefreshJob>): Promise<void> {
    const result = await this.catalog.refreshAllEnabled();
    if (result.organizations > 0 && result.refreshed === 0) {
      // Faz BullMQ aplicar as tentativas configuradas. Mesmo após as tentativas,
      // a validade não é ampliada: RAG exclui a fonte quando ela vence.
      throw new Error('Nenhuma organização teve o catálogo IXC renovado');
    }
    if (result.failed > 0) {
      this.logger.warn(`Catálogo IXC renovado para ${result.refreshed}/${result.organizations} organização(ões)`);
    }
  }
}
