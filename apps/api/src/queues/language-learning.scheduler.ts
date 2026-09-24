import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES } from './queues.constants';

/** Varredura em lote fora do caminho da resposta ao cliente. */
@Injectable()
export class LanguageLearningScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(LanguageLearningScheduler.name);

  constructor(@InjectQueue(QUEUES.LANGUAGE_LEARNING) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.add('learn', {}, { jobId: `language-learning-startup-${Date.now()}` });
      await this.queue.add('learn', {}, {
        repeat: { every: 24 * 60 * 60 * 1_000 }, jobId: 'language-learning-daily',
      });
    } catch (error) {
      this.logger.warn(`Falha ao agendar aprendizagem linguística: ${(error as Error).message}`);
    }
  }
}
