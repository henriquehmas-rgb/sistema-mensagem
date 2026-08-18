import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpMetricsInterceptor } from './metrics/http-metrics.interceptor';
import { MetricsCoreModule } from './metrics/metrics-core.module';
import { MetricsModule } from './metrics/metrics.module';
import { LoggingModule } from './logging/logging.module';
import { SentryExceptionFilter } from './sentry/sentry-exception.filter';
import { SentryModule } from './sentry/sentry.module';

/**
 * Módulo raiz de observabilidade (CONTRACTS §14) — único import novo em
 * app.module.ts. Reúne:
 * - LoggingModule: AppLogger (ligado em main.ts via `app.useLogger()`).
 * - MetricsModule (+ MetricsCoreModule): GET /api/metrics + interceptor HTTP
 *   global (contador/duração por rota/método/status).
 * - SentryModule: captura opcional de exceções (filtro global HTTP).
 *
 * MetricsCoreModule é importado aqui TAMBÉM (além de dentro de MetricsModule)
 * só para o `useClass: HttpMetricsInterceptor` do APP_INTERCEPTOR abaixo
 * conseguir resolver a dependência — reimportar um módulo já importado em
 * outro lugar é seguro no Nest (mesma instância singleton).
 */
@Module({
  imports: [LoggingModule, MetricsCoreModule, MetricsModule, SentryModule],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    { provide: APP_FILTER, useClass: SentryExceptionFilter },
  ],
})
export class ObservabilityModule {}
