import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Logger, Res, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { QUEUES } from '../../queues/queues.constants';
import { MetricsTokenGuard } from './metrics-token.guard';
import { MetricsService } from './metrics.service';

/** Estados de fila expostos no gauge — CONTRACTS §14. */
const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

// BullMQ exige `maxRetriesPerRequest: null` na conexão (retry é gerenciado
// pelo próprio BullMQ) e mantém `enableOfflineQueue` — com Redis fora do ar,
// `getJobCounts()` fica pendurado esperando a reconexão em vez de rejeitar
// (mesmo problema que o `Promise.race` já resolve em HealthController/
// RedisService). Sem este timeout, UM scrape de /metrics travaria a resposta
// inteira indefinidamente enquanto Redis estivesse indisponível.
const QUEUE_COUNTS_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

/**
 * GET /api/metrics (CONTRACTS §14) — VERSION_NEUTRAL, `@SkipThrottle`.
 *
 * `@Public()` é necessário para não exigir JWT de usuário (Prometheus/curl
 * não têm um access token de agente) — a rota NÃO fica por isso sem proteção:
 * `@UseGuards(MetricsTokenGuard)` é a autorização real (`X-Metrics-Token`),
 * aplicada em cima do bypass do JwtAuthGuard, não no lugar dele. Diferente de
 * health/media (públicos e sem NENHUM controle), aqui sempre há um guard
 * dedicado decidindo 401/200.
 */
@Public()
@SkipThrottle()
@UseGuards(MetricsTokenGuard)
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(
    private readonly metrics: MetricsService,
    @InjectQueue(QUEUES.WEBHOOK_INGEST) private readonly webhookIngestQueue: Queue,
    @InjectQueue(QUEUES.MESSAGE_OUTBOUND) private readonly messageOutboundQueue: Queue,
    @InjectQueue(QUEUES.AI_REPLY) private readonly aiReplyQueue: Queue,
    @InjectQueue(QUEUES.AUTOMATION_RUN) private readonly automationRunQueue: Queue,
    @InjectQueue(QUEUES.KNOWLEDGE_INGEST) private readonly knowledgeIngestQueue: Queue,
  ) {}

  @Get()
  async get(@Res() res: Response): Promise<void> {
    await this.refreshQueueDepths();
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.metricsText());
  }

  /** Atualiza o gauge sob demanda (sem polling em background) a cada scrape. */
  private async refreshQueueDepths(): Promise<void> {
    const queues: ReadonlyArray<readonly [string, Queue]> = [
      [QUEUES.WEBHOOK_INGEST, this.webhookIngestQueue],
      [QUEUES.MESSAGE_OUTBOUND, this.messageOutboundQueue],
      [QUEUES.AI_REPLY, this.aiReplyQueue],
      [QUEUES.AUTOMATION_RUN, this.automationRunQueue],
      [QUEUES.KNOWLEDGE_INGEST, this.knowledgeIngestQueue],
    ];

    await Promise.all(
      queues.map(async ([name, queue]) => {
        try {
          const counts = await withTimeout(
            queue.getJobCounts(...QUEUE_STATES),
            QUEUE_COUNTS_TIMEOUT_MS,
          );
          for (const state of QUEUE_STATES) {
            this.metrics.setQueueDepth(name, state, counts[state] ?? 0);
          }
        } catch (error) {
          // Redis fora do ar não pode derrubar o /metrics inteiro — mantém o
          // último valor conhecido do gauge para esta fila.
          this.logger.warn(
            `Falha ao consultar profundidade da fila ${name}: ${(error as Error).message}`,
          );
        }
      }),
    );
  }
}
