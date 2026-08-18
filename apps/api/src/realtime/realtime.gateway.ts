import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { AuthUser, JwtAccessPayload } from '../auth/interfaces/auth-user.interface';
import { UserStatusService } from '../auth/user-status.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from './realtime.service';
import { SOCKET_NAMESPACE, socketRooms } from './socket-events';

interface SocketData {
  user: AuthUser;
}

type RtSocket = Socket & { data: SocketData };

/**
 * Gateway Socket.io — namespace /rt, path /socket.io (CONTRACTS §5).
 * - Auth: JWT em handshake.auth.token (middleware rejeita conexão inválida).
 * - Join automático em org:{orgId} ao conectar.
 * - conversation:join/leave valida que a conversa pertence à org do socket.
 * - typing: rebroadcast no room da conversa (exceto o emissor).
 */
@WebSocketGateway({ namespace: SOCKET_NAMESPACE })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly userStatus: UserStatusService,
  ) {}

  afterInit(namespace: Namespace): void {
    this.realtime.attach(namespace);

    // Middleware de autenticação: rejeita o handshake ANTES do connect.
    namespace.use((socket, next) => {
      void (async () => {
        const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)
          ?.token;
        if (typeof token !== 'string' || token.length === 0) {
          next(new Error('unauthorized'));
          return;
        }
        try {
          const payload = await this.jwtService.verifyAsync<JwtAccessPayload & { scope?: string }>(
            token,
          );
          // Tokens de escopo restrito (ex.: visitorToken do webchat) não entram no /rt.
          if (payload.scope !== undefined || !payload.role || !payload.orgId) {
            next(new Error('unauthorized'));
            return;
          }
          // Mesma regra do JwtStrategy: usuário desativado não conecta (janela ≤30s).
          if (!(await this.userStatus.isActive(payload.sub))) {
            next(new Error('unauthorized'));
            return;
          }
          (socket as RtSocket).data.user = {
            userId: payload.sub,
            orgId: payload.orgId,
            role: payload.role,
          };
          next();
        } catch {
          next(new Error('unauthorized'));
        }
      })();
    });
  }

  handleConnection(socket: RtSocket): void {
    const user = socket.data.user;
    if (!user) {
      // defesa em profundidade — o middleware já deveria ter rejeitado
      socket.disconnect(true);
      return;
    }
    void socket.join(socketRooms.org(user.orgId));
  }

  @SubscribeMessage('conversation:join')
  async handleConversationJoin(
    @ConnectedSocket() socket: RtSocket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<{ ok: boolean }> {
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    if (!conversationId) {
      return { ok: false };
    }
    // Sem contexto de request no WS → prismaSystem com filtro de org EXPLÍCITO.
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId: socket.data.user.orgId },
      select: { id: true },
    });
    if (!conversation) {
      this.logger.warn(
        `conversation:join negado (socket=${socket.id}, conversation=${conversationId})`,
      );
      return { ok: false };
    }
    await socket.join(socketRooms.conversation(conversationId));
    return { ok: true };
  }

  @SubscribeMessage('conversation:leave')
  async handleConversationLeave(
    @ConnectedSocket() socket: RtSocket,
    @MessageBody() body: { conversationId?: unknown },
  ): Promise<{ ok: boolean }> {
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    if (!conversationId) {
      return { ok: false };
    }
    await socket.leave(socketRooms.conversation(conversationId));
    return { ok: true };
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() socket: RtSocket,
    @MessageBody() body: { conversationId?: unknown; isTyping?: unknown },
  ): void {
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : null;
    if (!conversationId || typeof body.isTyping !== 'boolean') {
      return;
    }
    const room = socketRooms.conversation(conversationId);
    // Só rebroadcasta se o socket entrou no room (ou seja, passou pela validação de org).
    if (!socket.rooms.has(room)) {
      return;
    }
    socket.to(room).emit('typing', {
      conversationId,
      userId: socket.data.user.userId,
      isTyping: body.isTyping,
    });
  }
}
