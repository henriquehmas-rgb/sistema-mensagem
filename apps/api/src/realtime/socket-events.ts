import type { MessageStatus } from '@prisma/client';
import type { ContactDto, ConversationDto, MessageDto } from '../common/serializers';

/**
 * Contrato Socket.io — namespace /rt (CONTRACTS §5).
 * Nomes de eventos e payloads espelham EXATAMENTE packages/shared/src/socket.ts
 * (a api não importa @sm/shared — CONTRACTS §10).
 */

export const SOCKET_NAMESPACE = '/rt';

export const socketRooms = {
  org: (orgId: string): string => `org:${orgId}`,
  conversation: (id: string): string => `conversation:${id}`,
} as const;

/** Server→Client — payload sempre com o recurso completo serializado. */
export interface ServerToClientEvents {
  'message:new': { message: MessageDto; conversation: ConversationDto };
  'message:status': { messageId: string; conversationId: string; status: MessageStatus };
  'conversation:new': { conversation: ConversationDto };
  'conversation:updated': { conversation: ConversationDto };
  'conversation:moved': {
    conversationId: string;
    stageId: string;
    stagePosition: number;
    movedBy: string | null;
  };
  typing: { conversationId: string; userId?: string; contactId?: string; isTyping: boolean };
  'contact:updated': { contact: ContactDto };
}

/** Client→Server */
export interface ClientToServerEvents {
  'conversation:join': { conversationId: string };
  'conversation:leave': { conversationId: string };
  typing: { conversationId: string; isTyping: boolean };
}
