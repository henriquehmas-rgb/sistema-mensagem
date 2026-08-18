import { Module } from '@nestjs/common';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsService } from './metrics.service';

/**
 * Núcleo de métricas (Registry + contadores/histogramas/gauge + interceptor
 * HTTP) SEM dependência de QueueModule — evita ciclo de módulos, já que
 * QueueModule importa este módulo para instrumentar o AiReplyProcessor
 * (histograma `ai_reply_duration_seconds`) e MetricsModule (que expõe
 * GET /api/metrics) precisa, ele sim, do QueueModule para ler a profundidade
 * das filas. Ver observability.module.ts para o grafo completo.
 */
@Module({
  providers: [MetricsService, HttpMetricsInterceptor],
  exports: [MetricsService, HttpMetricsInterceptor],
})
export class MetricsCoreModule {}
