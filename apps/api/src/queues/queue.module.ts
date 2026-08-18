import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { AiServiceClient } from './ai-service.client';
import { AiReplyProcessor } from './processors/ai-reply.processor';
import { AutomationRunProcessor } from './processors/automation-run.processor';
import { KnowledgeIngestProcessor } from './processors/knowledge-ingest.processor';
import { MessageOutboundProcessor } from './processors/message-outbound.processor';
import { QUEUES } from './queues.constants';

/**
 * QueueModule (CONTRACTS §4): registra TODAS as filas do produto (defaults de
 * attempts/backoff/removeOnComplete vêm do BullModule.forRootAsync em app.module)
 * e hospeda os processors de outbound/IA/automação/knowledge. Módulos de domínio
 * importam este módulo para @InjectQueue nas filas.
 * O processor de `webhook-ingest` vive no WebhooksModule (junto do controller
 * público que produz os jobs).
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUES.WEBHOOK_INGEST },
      { name: QUEUES.MESSAGE_OUTBOUND },
      { name: QUEUES.AI_REPLY },
      { name: QUEUES.AUTOMATION_RUN },
      { name: QUEUES.KNOWLEDGE_INGEST },
    ),
    // MetaGraphService — envio real WhatsApp no MessageOutboundProcessor.
    ChannelsModule,
  ],
  providers: [
    AiServiceClient,
    MessageOutboundProcessor,
    AiReplyProcessor,
    AutomationRunProcessor,
    KnowledgeIngestProcessor,
  ],
  exports: [BullModule],
})
export class QueueModule {}
