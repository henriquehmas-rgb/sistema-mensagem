import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { IxcModule } from '../integrations/ixc/ixc.module';
import { OlhoDeDeusModule } from '../integrations/olho-de-deus/olho-de-deus.module';
import { KnowledgeGapsModule } from '../knowledge-gaps/knowledge-gaps.module';
import { MetricsCoreModule } from '../observability/metrics/metrics-core.module';
import { SupportCaseStateModule } from '../support-case-state/support-case-state.module';
import { OperationalIncidentsModule } from '../operational-incidents/operational-incidents.module';
import { AiServiceClient } from './ai-service.client';
import { AiReplyProcessor } from './processors/ai-reply.processor';
import { AutomationRunProcessor } from './processors/automation-run.processor';
import { KnowledgeIngestProcessor } from './processors/knowledge-ingest.processor';
import { MemorySummarizeProcessor } from './processors/memory-summarize.processor';
import { ConversationInactivityProcessor } from './processors/conversation-inactivity.processor';
import { ConversationInactivityScheduler } from './conversation-inactivity.scheduler';
import { LanguageLearningProcessor } from './processors/language-learning.processor';
import { LanguageLearningScheduler } from './language-learning.scheduler';
import { FollowUpProcessor } from './processors/follow-up.processor';
import { FollowUpService } from '../follow-up/follow-up.service';
import { MessageOutboundProcessor } from './processors/message-outbound.processor';
import { WhatsappPresenceProcessor } from './processors/whatsapp-presence.processor';
import { SalesAutoViabilityFlowService } from './sales-auto-viability-flow.service';
import { PostalAddressLookupService } from './postal-address-lookup.service';
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
      { name: QUEUES.WHATSAPP_PRESENCE },
      { name: QUEUES.AI_REPLY },
      { name: QUEUES.AUTOMATION_RUN },
      { name: QUEUES.KNOWLEDGE_INGEST },
      { name: QUEUES.MEMORY_SUMMARIZE },
      { name: QUEUES.LANGUAGE_LEARNING },
      { name: QUEUES.FOLLOW_UP },
      { name: QUEUES.CONVERSATION_INACTIVITY },
    ),
    // MetaGraphService — envio real WhatsApp no MessageOutboundProcessor.
    ChannelsModule,
    IxcModule,
    OlhoDeDeusModule,
    KnowledgeGapsModule,
    SupportCaseStateModule,
    OperationalIncidentsModule,
    // Histograma ai_reply_duration_seconds (CONTRACTS §14), populado pelo
    // AiReplyProcessor ao redor da chamada HTTP api→ia. Módulo SEM
    // dependência deste (QueueModule) — evita ciclo com MetricsModule, que
    // por sua vez importa QueueModule para o gauge de profundidade das filas.
    MetricsCoreModule,
  ],
  providers: [
    AiServiceClient,
    SalesAutoViabilityFlowService,
    PostalAddressLookupService,
    MessageOutboundProcessor,
    WhatsappPresenceProcessor,
    AiReplyProcessor,
    AutomationRunProcessor,
    KnowledgeIngestProcessor,
    MemorySummarizeProcessor,
    LanguageLearningProcessor,
    LanguageLearningScheduler,
    ConversationInactivityProcessor,
    ConversationInactivityScheduler,
    FollowUpProcessor,
    FollowUpService,
  ],
  exports: [BullModule, AiServiceClient, FollowUpService],
})
export class QueueModule {}
