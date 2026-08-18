import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES, type MediaCleanupJob } from '../queues/queues.constants';

/** A cada 6h — frequente o bastante para conter o vetor de esgotamento de disco sem sobrecarregar o Postgres. */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** jobId fixo: BullMQ é idempotente para `repeat` com o mesmo id — reinícios/múltiplas réplicas da api não duplicam o agendamento. */
const REPEAT_JOB_ID = 'media-cleanup-repeat';

/**
 * Agenda o job repetível `media-cleanup` (CONTRACTS §13) no boot da
 * aplicação. Falha ao agendar (ex.: Redis indisponível no boot) é só logada —
 * nunca derruba o boot da api por causa de um job de limpeza best-effort.
 */
@Injectable()
export class MediaCleanupScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaCleanupScheduler.name);

  constructor(@InjectQueue(QUEUES.MEDIA_CLEANUP) private readonly queue: Queue<MediaCleanupJob>) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.add(
        'cleanup',
        {},
        { repeat: { every: CLEANUP_INTERVAL_MS }, jobId: REPEAT_JOB_ID },
      );
    } catch (error) {
      this.logger.warn(`Falha ao agendar job repetível media-cleanup: ${(error as Error).message}`);
    }
  }
}
