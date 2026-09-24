import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES, type IxcCatalogRefreshJob } from '../../queues/queues.constants';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const REPEAT_JOB_ID = 'ixc-sales-catalog-refresh-daily';

/**
 * Agenda a renovação antes do TTL factual de 26h. O job só chama a leitura
 * IXC: falhas não estendem validade, nem mantêm uma fonte vencida em uso.
 */
@Injectable()
export class IxcCatalogRefreshScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IxcCatalogRefreshScheduler.name);

  constructor(@InjectQueue(QUEUES.IXC_CATALOG_REFRESH) private readonly queue: Queue<IxcCatalogRefreshJob>) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.add(
        'refresh-sales-catalog',
        {},
        { repeat: { every: REFRESH_INTERVAL_MS }, jobId: REPEAT_JOB_ID },
      );
    } catch (error) {
      // O catálogo segue protegido pela expiração; uma falha de agenda não
      // derruba o atendimento e permanece observável pelo endpoint de status.
      this.logger.warn(`Falha ao agendar atualização do catálogo IXC: ${(error as Error).message}`);
    }
  }
}
