/**
 * Filas BullMQ (CONTRACTS §4) — prefixo `sm` configurado no BullModule.forRootAsync.
 * Defaults (attempts: 3, backoff exponencial, removeOnComplete {count: 1000})
 * também vêm do forRootAsync (app.module.ts).
 */
export const QUEUES = {
  WEBHOOK_INGEST: 'webhook-ingest',
  MESSAGE_OUTBOUND: 'message-outbound',
  AI_REPLY: 'ai-reply',
  AUTOMATION_RUN: 'automation-run',
  KNOWLEDGE_INGEST: 'knowledge-ingest',
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
}

export interface AiReplyJob {
  orgId: string;
  conversationId: string;
  messageId: string;
}

/** Eventos de negócio que disparam automações (Automation.trigger.event). */
export const AUTOMATION_EVENTS = [
  'message.inbound',
  'conversation.created',
  'conversation.handoff',
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
