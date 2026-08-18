import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MessageDirection,
  MessageStatus,
  MessageType,
  type Prisma,
} from '@prisma/client';
import { Queue } from 'bullmq';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import {
  conversationInclude,
  messageInclude,
  messagePreview,
  toConversationDto,
  toMessageDto,
  type MessageDto,
} from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, type MessageOutboundJob } from '../queues/queues.constants';
import { RealtimeService } from '../realtime/realtime.service';
import type { CreateMessageDto } from './dto/create-message.dto';
import type { ListMessagesQuery } from './dto/list-messages.query';

export interface MessagePageDto {
  data: MessageDto[];
  nextCursor: string | null;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @InjectQueue(QUEUES.MESSAGE_OUTBOUND)
    private readonly messageOutboundQueue: Queue<MessageOutboundJob>,
  ) {}

  /**
   * GET /conversations/:id/messages — cursor = id da msg mais antiga carregada,
   * ordem desc (mais recentes primeiro). Retorna {data, nextCursor}.
   */
  async list(conversationId: string, query: ListMessagesQuery): Promise<MessagePageDto> {
    await this.assertConversation(conversationId);

    const messages = await this.prisma.tenant.message.findMany({
      where: { conversationId },
      include: messageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1, // +1 para saber se há página seguinte
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = messages.length > query.limit;
    const page = hasMore ? messages.slice(0, query.limit) : messages;
    return {
      data: page.map(toMessageDto),
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1]!.id : null,
    };
  }

  /**
   * POST /conversations/:id/messages — cria Message OUTBOUND PENDING (autor =
   * usuário logado), atualiza lastMessageAt/preview, emite message:new e
   * enfileira `message-outbound` (CONTRACTS §4/§6).
   */
  async send(conversationId: string, dto: CreateMessageDto, actor: AuthUser): Promise<MessageDto> {
    const conversation = await this.assertConversation(conversationId);
    await this.validateContent(dto.type, dto.content, conversation.channelId);

    const preview = messagePreview(dto.type, dto.content);
    const message = await this.prisma.tenant.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          // a extension injeta o mesmo orgId em runtime; explícito aqui p/ o type system
          orgId: actor.orgId,
          conversationId,
          direction: MessageDirection.OUTBOUND,
          type: dto.type,
          content: dto.content as Prisma.InputJsonValue,
          status: MessageStatus.PENDING,
          authorId: actor.userId,
        },
        include: messageInclude,
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt, lastMessagePreview: preview },
      });
      return created;
    });

    // Enfileira ANTES de emitir message:new: se o Redis estiver fora, o estado
    // observável fica consistente — a mensagem é marcada FAILED (com errorMessage),
    // o evento sai já com o status final e o cliente recebe 503 com semântica de retry.
    try {
      await this.messageOutboundQueue.add('deliver', {
        orgId: actor.orgId,
        messageId: message.id,
      });
    } catch (error) {
      this.logger.error(
        `Falha ao enfileirar message-outbound (message=${message.id}): ${(error as Error).message}`,
      );
      try {
        const failed = await this.prisma.tenant.message.update({
          where: { id: message.id },
          data: {
            status: MessageStatus.FAILED,
            errorMessage: 'Falha ao enfileirar a entrega (fila indisponível)',
          },
          include: messageInclude,
        });
        await this.emitMessageNew(conversationId, actor.orgId, failed);
      } catch (markError) {
        // Best-effort: não mascara o 503 se nem o mark FAILED for possível.
        this.logger.error(
          `Falha ao marcar mensagem ${message.id} como FAILED: ${(markError as Error).message}`,
        );
      }
      throw new ServiceUnavailableException(
        'Mensagem registrada, mas a entrega não pôde ser enfileirada — tente reenviar',
      );
    }

    await this.emitMessageNew(conversationId, actor.orgId, message);
    return toMessageDto(message);
  }

  private async emitMessageNew(
    conversationId: string,
    orgId: string,
    message: Parameters<typeof toMessageDto>[0],
  ): Promise<void> {
    const conversation = await this.prisma.tenant.conversation.findUnique({
      where: { id: conversationId },
      include: conversationInclude,
    });
    if (conversation) {
      this.realtime.emitMessageNew(orgId, {
        message: toMessageDto(message),
        conversation: toConversationDto(conversation),
      });
    }
  }

  /** Coerência mínima content×type — o restante é responsabilidade do canal. */
  private async validateContent(
    type: MessageType,
    content: Record<string, unknown>,
    channelId: string,
  ): Promise<void> {
    const requireString = (key: string): void => {
      const value = content[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new BadRequestException(`content.${key} é obrigatório para mensagens ${type}`);
      }
    };

    switch (type) {
      case MessageType.TEXT:
        requireString('text');
        if ((content.text as string).length > 4096) {
          throw new BadRequestException('content.text excede 4096 caracteres');
        }
        return;
      case MessageType.IMAGE:
      case MessageType.AUDIO:
      case MessageType.VIDEO:
      case MessageType.DOCUMENT:
      case MessageType.STICKER:
        requireString('mediaUrl');
        requireString('mimeType');
        return;
      case MessageType.LOCATION:
        if (
          typeof content.latitude !== 'number' ||
          typeof content.longitude !== 'number' ||
          !Number.isFinite(content.latitude) ||
          !Number.isFinite(content.longitude)
        ) {
          throw new BadRequestException('content.latitude/longitude são obrigatórios para LOCATION');
        }
        return;
      case MessageType.TEMPLATE: {
        requireString('templateName');
        // CONTRACTS §12: `language` é obrigatório de fato — cada (name, language) é
        // um template distinto na Meta; sem isso, meta-graph.service.ts cai
        // silenciosamente no fallback pt_BR (bug já corrigido lá, mas o client
        // deveria ter que ser explícito).
        requireString('language');
        const templateName = content.templateName as string;
        const language = content.language as string;
        const template = await this.prisma.tenant.messageTemplate.findFirst({
          where: { channelId, name: templateName, language },
          select: { bodyParamsCount: true },
        });
        if (!template) {
          throw new BadRequestException(
            `Template "${templateName}" (${language}) não encontrado para este canal — sincronize em Configurações → Canais → Templates`,
          );
        }
        const params = Array.isArray(content.params) ? content.params : [];
        if (params.length !== template.bodyParamsCount) {
          throw new BadRequestException(
            `content.params deve ter ${template.bodyParamsCount} item(ns) para este template (recebido ${params.length})`,
          );
        }
        return;
      }
      case MessageType.SYSTEM:
        // bloqueado no DTO (@NotEquals) — defesa em profundidade
        throw new BadRequestException('mensagens SYSTEM são geradas pelo servidor');
    }
  }

  private async assertConversation(
    conversationId: string,
  ): Promise<{ id: string; channelId: string }> {
    const conversation = await this.prisma.tenant.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, channelId: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada');
    }
    return conversation;
  }
}
