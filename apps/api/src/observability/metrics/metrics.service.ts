import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Registro Prometheus da api (CONTRACTS §14) — Registry PRÓPRIO (não o
 * `register` default do módulo) para não misturar com outra instância que
 * porventura exista no processo (ex.: testes rodando vários serviços).
 *
 * Métricas:
 * - `http_requests_total` / `http_request_duration_seconds`: por rota
 *   (padrão registrado, com `:params`, nunca a URL crua — evita explosão de
 *   séries por id) + método + status, populadas pelo HttpMetricsInterceptor.
 * - `bullmq_queue_jobs`: gauge de profundidade por fila/estado
 *   (waiting/active/delayed/failed), atualizada sob demanda por
 *   MetricsController a cada GET /api/metrics via `Queue.getJobCounts()`.
 * - `ai_reply_duration_seconds`: histograma da latência da chamada HTTP
 *   api→ia em `/reply`, populado pelo AiReplyProcessor.
 * - default metrics do Node (`collectDefaultMetrics`) — CPU/memória/event loop.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly httpRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
  private readonly httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_code'>;
  private readonly queueDepthGauge: Gauge<'queue' | 'state'>;
  private readonly aiReplyDurationSeconds: Histogram<string>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de requisições HTTP por rota/método/status',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duração das requisições HTTP em segundos, por rota/método/status',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.queueDepthGauge = new Gauge({
      name: 'bullmq_queue_jobs',
      help: 'Profundidade das filas BullMQ por estado (waiting/active/delayed/failed)',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
    });

    this.aiReplyDurationSeconds = new Histogram({
      name: 'ai_reply_duration_seconds',
      help: 'Latência da chamada HTTP api→ia (POST /reply)',
      buckets: [0.1, 0.3, 0.5, 1, 2, 5, 10, 20, 30],
      registers: [this.registry],
    });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  async metricsText(): Promise<string> {
    return this.registry.metrics();
  }

  recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }

  setQueueDepth(queue: string, state: string, value: number): void {
    this.queueDepthGauge.set({ queue, state }, value);
  }

  observeAiReplyDuration(durationSeconds: number): void {
    this.aiReplyDurationSeconds.observe(durationSeconds);
  }
}
