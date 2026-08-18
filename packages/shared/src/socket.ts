// Contrato Socket.io — namespace /rt. Manter em sincronia com docs/CONTRACTS.md §5.

import type { ContactDto, ConversationDto, MessageDto } from "./models";
import type { MessageStatus } from "./enums";

/** Eventos emitidos pelo servidor (rooms org:{orgId} e conversation:{id}) */
export interface ServerToClientEvents {
  "message:new": (p: { message: MessageDto; conversation: ConversationDto }) => void;
  "message:updated": (p: { message: MessageDto }) => void;
  "message:status": (p: {
    messageId: string;
    conversationId: string;
    status: MessageStatus;
  }) => void;
  "conversation:new": (p: { conversation: ConversationDto }) => void;
  "conversation:updated": (p: { conversation: ConversationDto }) => void;
  "conversation:moved": (p: {
    conversationId: string;
    stageId: string;
    stagePosition: number;
    movedBy: string | null;
  }) => void;
  typing: (p: {
    conversationId: string;
    userId?: string;
    contactId?: string;
    isTyping: boolean;
  }) => void;
  "contact:updated": (p: { contact: ContactDto }) => void;
}

/** Eventos enviados pelo cliente */
export interface ClientToServerEvents {
  "conversation:join": (p: { conversationId: string }) => void;
  "conversation:leave": (p: { conversationId: string }) => void;
  typing: (p: { conversationId: string; isTyping: boolean }) => void;
}

export const SOCKET_NAMESPACE = "/rt";
export const socketRooms = {
  org: (orgId: string) => `org:${orgId}`,
  conversation: (id: string) => `conversation:${id}`,
};
