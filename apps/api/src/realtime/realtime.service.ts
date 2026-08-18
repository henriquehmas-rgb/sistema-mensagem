import { Injectable, Logger } from '@nestjs/common';
import type { MessageStatus } from '@prisma/client';
import type { Namespace } from 'socket.io';
import type { ContactDto, ConversationDto } from '../common/serializers';
import { socketRooms, type ServerToClientEvents } from './socket-events';

/**
 * Única porta de saída de eventos realtime (CONTRACTS §5): services de domínio e
 * processors NUNCA emitem direto no Socket.io — sempre via estes métodos tipados.
 * Publica no room `org:{orgId}`; com o Redis adapter os eventos alcançam todas
 * as instâncias da api.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private namespace: Namespace | null = null;
  private webchatNamespace: Namespace | null = null;

  /** Chamado pelo RealtimeGateway em afterInit. */
  attach(namespace: Namespace): void {
    this.namespace = namespace;
  }

  /** Chamado pelo WebchatGateway em afterInit (namespace /webchat). */
  attachWebchat(namespace: Namespace): void {
    this.webchatNamespace = namespace;
  }

  emitMessageNew(orgId: string, payload: ServerToClientEvents['message:new']): void {
    this.emitToOrg(orgId, 'message:new', payload);
    // Relay para o visitante do webchat: SÓ a mensagem (nada de conversation/
    // assignee/unread) e nunca mensagens SYSTEM (notas internas de handoff).
    if (payload.message.type !== 'SYSTEM') {
      this.webchatNamespace
        ?.to(socketRooms.conversation(payload.message.conversationId))
        .emit('message:new', { message: payload.message });
    }
  }

  emitMessageStatus(
    orgId: string,
    payload: { messageId: string; conversationId: string; status: MessageStatus },
  ): void {
    this.emitToOrg(orgId, 'message:status', payload);
    this.webchatNamespace
      ?.to(socketRooms.conversation(payload.conversationId))
      .emit('message:status', payload);
  }

  emitConversationNew(orgId: string, payload: { conversation: ConversationDto }): void {
    this.emitToOrg(orgId, 'conversation:new', payload);
  }

  emitConversationUpdated(orgId: string, payload: { conversation: ConversationDto }): void {
    this.emitToOrg(orgId, 'conversation:updated', payload);
  }

  emitConversationMoved(
    orgId: string,
    payload: {
      conversationId: string;
      stageId: string;
      stagePosition: number;
      movedBy: string | null;
    },
  ): void {
    this.emitToOrg(orgId, 'conversation:moved', payload);
  }

  emitContactUpdated(orgId: string, payload: { contact: ContactDto }): void {
    this.emitToOrg(orgId, 'contact:updated', payload);
  }

  private emitToOrg<K extends keyof ServerToClientEvents>(
    orgId: string,
    event: K,
    payload: ServerToClientEvents[K],
  ): void {
    if (!this.namespace) {
      this.logger.warn(`Gateway ainda não inicializado — evento ${event} descartado`);
      return;
    }
    this.namespace.to(socketRooms.org(orgId)).emit(event, payload);
  }
}
