import { Module } from '@nestjs/common';
import { QueueModule } from '../../queues/queue.module';
import { MetricsCoreModule } from './metrics-core.module';
import { MetricsController } from './metrics.controller';
import { MetricsTokenGuard } from './metrics-token.guard';

/**
 * Expõe GET /api/metrics (CONTRACTS §14): registro Prometheus (MetricsCoreModule)
 * + acesso às 5 filas BullMQ (QueueModule) para o gauge de profundidade.
 */
@Module({
  imports: [MetricsCoreModule, QueueModule],
  controllers: [MetricsController],
  providers: [MetricsTokenGuard],
})
export class MetricsModule {}
