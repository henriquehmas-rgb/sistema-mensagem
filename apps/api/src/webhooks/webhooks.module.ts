import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { InboundModule } from '../inbound/inbound.module';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queues/queue.module';
import { WebhookIngestProcessor } from './webhook-ingest.processor';
import { WebhooksController } from './webhooks.controller';

/**
 * Webhooks Meta (CONTRACTS §6): controller público com verificação HMAC que
 * responde 200 imediato e enfileira; o processor `webhook-ingest` vive aqui
 * (a fila é registrada no QueueModule). ChannelsModule fornece o
 * MetaGraphService (perfil IG best-effort no inbound do Instagram);
 * MediaModule fornece o MediaService (re-host de mídia inbound WhatsApp).
 */
@Module({
  imports: [QueueModule, InboundModule, ChannelsModule, MediaModule],
  controllers: [WebhooksController],
  providers: [WebhookIngestProcessor],
})
export class WebhooksModule {}
