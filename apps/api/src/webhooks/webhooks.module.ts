import { Module } from '@nestjs/common';
import { InboundModule } from '../inbound/inbound.module';
import { QueueModule } from '../queues/queue.module';
import { WebhookIngestProcessor } from './webhook-ingest.processor';
import { WebhooksController } from './webhooks.controller';

/**
 * Webhooks Meta (CONTRACTS §6): controller público com verificação HMAC que
 * responde 200 imediato e enfileira; o processor `webhook-ingest` vive aqui
 * (a fila é registrada no QueueModule).
 */
@Module({
  imports: [QueueModule, InboundModule],
  controllers: [WebhooksController],
  providers: [WebhookIngestProcessor],
})
export class WebhooksModule {}
