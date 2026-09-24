import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUES, type ConversationInactivityJob } from './queues.constants';

const SWEEP_INTERVAL_MS = 60_000;

/** Agenda a varredura sem depender de tráfego novo do cliente. */
@Injectable()
export class ConversationInactivityScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ConversationInactivityScheduler.name);

  constructor(
    @InjectQueue(QUEUES.CONVERSATION_INACTIVITY)
    private readonly queue: Queue<ConversationInactivityJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Uma varredura imediata trata conversas que já estavam vencidas antes
      // de um restart; a repetível mantém o prazo enquanto a API está ativa.
      // BullMQ reserva ':' para IDs internos de repeat. Usar hífen impede que
      // a falha da varredura imediata bloqueie também o agendamento recorrente.
      await this.queue.add('sweep', {}, { jobId: `conversation-inactivity-startup-${Date.now()}` });
      await this.queue.add(
        'sweep',
        {},
        { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'conversation-inactivity-repeat' },
      );
    } catch (error) {
      this.logger.warn(`Falha ao agendar varredura de inatividade: ${(error as Error).message}`);
    }
  }
}
