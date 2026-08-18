import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { RealtimeService } from '../realtime/realtime.service';
import { socketRooms } from '../realtime/socket-events';
import { WebchatService, type WebchatTokenPayload } from './webchat.service';

export const WEBCHAT_NAMESPACE = '/webchat';

interface WebchatSocketData {
  visitor: WebchatTokenPayload;
}

type WebchatSocket = Socket & { data: WebchatSocketData };

/**
 * Namespace /webchat (CONTRACTS §6): visitante conecta com visitorToken em
 * handshake.auth.token e entra APENAS no room da própria conversa — recebe
 * message:new/message:status relayados pelo RealtimeService (sem payload
 * interno: nada de conversation/assignee/unread para o visitante).
 */
@WebSocketGateway({ namespace: WEBCHAT_NAMESPACE })
export class WebchatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(WebchatGateway.name);

  constructor(
    private readonly webchatService: WebchatService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(namespace: Namespace): void {
    this.realtime.attachWebchat(namespace);

    namespace.use((socket, next) => {
      void (async () => {
        const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)
          ?.token;
        if (typeof token !== 'string' || token.length === 0) {
          next(new Error('unauthorized'));
          return;
        }
        try {
          (socket as WebchatSocket).data.visitor = await this.webchatService.verifyToken(token);
          next();
        } catch {
          next(new Error('unauthorized'));
        }
      })();
    });
  }

  handleConnection(socket: WebchatSocket): void {
    const visitor = socket.data.visitor;
    if (!visitor) {
      socket.disconnect(true);
      return;
    }
    void socket.join(socketRooms.conversation(visitor.conversationId));
    this.logger.debug(`Visitante conectado (conversation=${visitor.conversationId})`);
  }

  /**
   * Typing do visitante → agentes com a conversa aberta no /rt. O payload do
   * cliente é só {isTyping}; conversationId/contactId vêm do token verificado.
   */
  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() socket: WebchatSocket,
    @MessageBody() body: { isTyping?: unknown },
  ): void {
    const visitor = socket.data.visitor;
    if (!visitor || typeof body?.isTyping !== 'boolean') {
      return;
    }
    this.realtime.emitTypingFromVisitor({
      conversationId: visitor.conversationId,
      contactId: visitor.sub,
      isTyping: body.isTyping,
    });
  }
}
