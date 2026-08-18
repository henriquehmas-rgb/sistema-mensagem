import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES, type MediaCleanupJob } from '../queues/queues.constants';
import { MediaCleanupService } from './media-cleanup.service';

/**
 * Processor `media-cleanup` (CONTRACTS §13, correção de revisão — high):
 * consome o job repetível agendado por `MediaCleanupScheduler` e delega a
 * varredura/remoção para `MediaCleanupService.run`. Sem payload — cada job
 * varre TODAS as orgs.
 */
@Processor(QUEUES.MEDIA_CLEANUP)
export class MediaCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaCleanupProcessor.name);

  constructor(private readonly cleanup: MediaCleanupService) {
    super();
  }

  async process(_job: Job<MediaCleanupJob>): Promise<void> {
    const result = await this.cleanup.run();
    this.logger.debug(
      `media-cleanup: ${result.scannedOrgs} org(s) verificada(s), ${result.deletedFiles} arquivo(s) removido(s)`,
    );
  }
}
