/**
 * Filas BullMQ (CONTRACTS §4) — prefixo `sm` configurado no BullModule.forRootAsync.
 * Defaults (attempts: 3, backoff exponencial, removeOnComplete {count: 1000})
 * também vêm do forRootAsync (app.module.ts).
 */
export const QUEUES = {
  WEBHOOK_INGEST: 'webhook-ingest',
  MESSAGE_OUTBOUND: 'message-outbound',
  WHATSAPP_PRESENCE: 'whatsapp-presence',
  AI_REPLY: 'ai-reply',
  AUTOMATION_RUN: 'automation-run',
  KNOWLEDGE_INGEST: 'knowledge-ingest',
  MEDIA_CLEANUP: 'media-cleanup',
  MEMORY_SUMMARIZE: 'memory-summarize',
  LANGUAGE_LEARNING: 'language-learning',
  FOLLOW_UP: 'follow-up',
  CONVERSATION_INACTIVITY: 'conversation-inactivity',
  IXC_CATALOG_REFRESH: 'ixc-catalog-refresh',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ====================== Payloads (CONTRACTS §4) ======================

export interface WebhookIngestJob {
  source: 'meta' | 'webchat';
  body: unknown;
  headers: Record<string, string>;
  receivedAt: string;
}

/** Nome do job de retry do re-host de mídia (mesma fila `webhook-ingest`). */
export const MEDIA_FETCH_JOB = 'media-fetch';

/**
 * Retry do re-host de mídia inbound WhatsApp: quando o fetch inline falha, a
 * Message nasce com content.mediaId e este job (delayed, até 3 tentativas)
 * completa o re-host e emite `message:updated`.
 */
export interface MediaFetchJob {
  orgId: string;
  channelId: string;
  messageId: string;
  mediaId: string;
}

export interface MessageOutboundJob {
  orgId: string;
  messageId: string;
  /** Entrega ordenada das bolhas de uma mesma resposta, com retry idempotente. */
  turnMessageIds?: string[];
}

export interface WhatsappPresenceJob {
  orgId: string;
  messageId: string;
}

export interface AiReplyJob {
  orgId: string;
  conversationId: string;
  messageId: string;
  /** Quando true, somente a mensagem inbound mais recente da conversa gera resposta. */
  coalesce?: boolean;
}

/** Eventos de negócio que disparam automações (Automation.trigger.event). */
export const AUTOMATION_EVENTS = [
  'message.inbound',
  'conversation.created',
  'conversation.handoff',
  'conversation.knowledge-gap',
] as const;

export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export function isAutomationEvent(value: unknown): value is AutomationEvent {
  return (
    typeof value === 'string' && (AUTOMATION_EVENTS as readonly string[]).includes(value)
  );
}

export interface AutomationRunJob {
  orgId: string;
  event: AutomationEvent;
  context: Record<string, unknown>;
}

export interface KnowledgeIngestJob {
  orgId: string;
  sourceId: string;
}

/** Atualização periódica de fontes factuais IXC; sem payload sensível. */
export type IxcCatalogRefreshJob = Record<string, never>;

/**
 * Job repetível `media-cleanup` (CONTRACTS §13, correção de revisão — high):
 * sem payload — cada execução varre TODAS as orgs em MEDIA_DIR/*\/uploads/
 * (MediaCleanupService.run). Agendado por MediaCleanupScheduler.
 */
export type MediaCleanupJob = Record<string, never>;

/** Etapa de follow-up agendada; o processor só libera revisão humana. */
export interface FollowUpJob {
  orgId: string;
  followUpId: string;
  conversationId: string;
  step: number;
}

/** Varredura periódica, sem payload de cliente, de conversas elegíveis ao encerramento por inatividade. */
export type ConversationInactivityJob = Record<string, never>;

/**
 * CONTRACTS §15: memória de longo prazo por contato. Produzido por
 * `ConversationsService.update` quando uma conversa transiciona PARA
 * RESOLVED e também pelo `AiReplyProcessor` em checkpoints de respostas
 * substantivas e fundamentadas. Consumido por `MemorySummarizeProcessor`.
 */
export interface MemorySummarizeJob {
  orgId: string;
  contactId: string;
  conversationId: string;
}
