import { createHash } from 'node:crypto';

interface OccurrenceIdentityInput {
  conversationId: string;
  messageId: string;
  customerId: string;
  networkEventId?: string | null;
}

/** Identidade estável em retry; um EventID prevalece sobre a mensagem que disparou a análise. */
export function deriveOccurrenceId(input: OccurrenceIdentityInput): string {
  const source = input.networkEventId
    ? `network:${input.networkEventId}:${input.customerId}`
    : `message:${input.conversationId}:${input.messageId}:${input.customerId}`;
  return `occ_${createHash('sha256').update(source).digest('hex').slice(0, 32)}`;
}

