import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { InboundMessageService } from './inbound-message.service';

/**
 * Fluxo INBOUND compartilhado: usado pelo processor `webhook-ingest` (Meta)
 * e pelo módulo de webchat — um único caminho para criação de contato/conversa,
 * dedupe por wamid, unreadCount, eventos realtime e enfileiramento de
 * ai-reply/automation-run.
 */
@Module({
  imports: [QueueModule],
  providers: [InboundMessageService],
  exports: [InboundMessageService],
})
export class InboundModule {}
