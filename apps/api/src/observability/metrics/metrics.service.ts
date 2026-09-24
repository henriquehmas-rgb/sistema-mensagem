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
 * - `ai_decisions_total`: decisão persistida pela IA por setor e resultado,
 *   com rótulos fechados (nunca texto do cliente, contato ou conversa).
 * - `ai_route_transitions_total`: mudanças entre setores, para detectar
 *   roteamento inesperado sem expor dados da conversa.
 * - `mcp_integration_outcomes_total`: resultado padronizado das leituras
 *   factuais do IXC e Olho de Deus, sem dados de cliente ou texto externo.
 * - default metrics do Node (`collectDefaultMetrics`) — CPU/memória/event loop.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly httpRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
  private readonly httpRequestDurationSeconds: Histogram<'method' | 'route' | 'status_code'>;
  private readonly queueDepthGauge: Gauge<'queue' | 'state'>;
  private readonly aiReplyDurationSeconds: Histogram<string>;
  private readonly identityVerificationTotal: Counter<'result'>;
  private readonly aiDecisionsTotal: Counter<'route_key' | 'outcome'>;
  private readonly aiRouteTransitionsTotal: Counter<'from_route' | 'to_route'>;
  private readonly mcpIntegrationOutcomesTotal: Counter<'integration' | 'source_status' | 'mcp_status' | 'learning_disposition'>;

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

    this.identityVerificationTotal = new Counter({
      name: 'identity_verification_total',
      help: 'Resultados da validação de identidade, sem dados pessoais ou identificadores',
      labelNames: ['result'],
      registers: [this.registry],
    });

    this.aiDecisionsTotal = new Counter({
      name: 'ai_decisions_total',
      help: 'Decisões persistidas da IA por setor e resultado, sem dados de clientes',
      labelNames: ['route_key', 'outcome'],
      registers: [this.registry],
    });

    this.aiRouteTransitionsTotal = new Counter({
      name: 'ai_route_transitions_total',
      help: 'Transições de setor da IA por rotas normalizadas, sem identificadores',
      labelNames: ['from_route', 'to_route'],
      registers: [this.registry],
    });

    this.mcpIntegrationOutcomesTotal = new Counter({
      name: 'mcp_integration_outcomes_total',
      help: 'Resultados normalizados de integrações em modo sombra, sem dados de clientes',
      labelNames: ['integration', 'source_status', 'mcp_status', 'learning_disposition'],
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

  recordIdentityVerification(result: 'verified' | 'failed' | 'locked' | 'unavailable' | 'unlocked'): void {
    this.identityVerificationTotal.inc({ result });
  }

  recordAiDecision(routeKey: string, outcome: 'reply' | 'clarification' | 'handoff'): void {
    this.aiDecisionsTotal.inc({ route_key: this.normalizedRouteKey(routeKey), outcome });
  }

  recordAiRouteTransition(fromRouteKey: string, toRouteKey: string): void {
    const fromRoute = this.normalizedRouteKey(fromRouteKey);
    const toRoute = this.normalizedRouteKey(toRouteKey);
    if (fromRoute === toRoute) return;
    this.aiRouteTransitionsTotal.inc({ from_route: fromRoute, to_route: toRoute });
  }

  /**
   * Métrica de comparação. Não muda o fluxo de atendimento nem inclui conversa,
   * telefone, identificador IXC ou qualquer texto externo como rótulo.
   */
  recordMcpIntegrationOutcome(
    integration: 'IXC' | 'OLHO_DE_DEUS',
    sourceStatus: 'SUCCESS' | 'EMPTY' | 'NOT_FOUND' | 'AMBIGUOUS' | 'UNAVAILABLE',
    mcpStatus: 'CONFIRMED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'AMBIGUOUS',
    learningDisposition: 'NO_LEARNING_TECHNICAL_INCIDENT' | 'NO_LEARNING_AMBIGUOUS_EVIDENCE' | 'ELIGIBLE_FOR_REVIEW',
  ): void {
    this.mcpIntegrationOutcomesTotal.inc({
      integration,
      source_status: sourceStatus,
      mcp_status: mcpStatus,
      learning_disposition: learningDisposition,
    });
  }

  /** Mantém a cardinalidade segura: somente os três setores e o fallback. */
  private normalizedRouteKey(routeKey: string): 'technical_support' | 'billing' | 'sales' | 'general' {
    if (routeKey === 'technical_support' || routeKey === 'billing' || routeKey === 'sales') {
      return routeKey;
    }
    return 'general';
  }
}
