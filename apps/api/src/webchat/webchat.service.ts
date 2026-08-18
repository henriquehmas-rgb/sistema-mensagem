import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ChannelStatus, ChannelType, MessageType } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  sanitizeMessageForVisitor,
  toConversationDto,
  toMessageDto,
  type MessageDto,
} from '../common/serializers';
import { InboundMessageService } from '../inbound/inbound-message.service';
import { MediaService, type StoredUpload, type UploadFileInput } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, type AutomationRunJob } from '../queues/queues.constants';
import { RealtimeService } from '../realtime/realtime.service';
import type { CreateWebchatMessageDto } from './dto/create-webchat-message.dto';
import type { CreateWebchatSessionDto } from './dto/create-webchat-session.dto';
import type { ListWebchatMessagesQuery } from './dto/list-webchat-messages.query';

const VISITOR_TOKEN_TTL = '7d';

/** Payload do visitorToken — escopo restrito: NÃO vale como access token de agente. */
export interface WebchatTokenPayload {
  sub: string; // contactId
  orgId: string;
  channelId: string;
  conversationId: string;
  scope: 'webchat';
}

export interface WebchatSessionDto {
  visitorToken: string;
  conversationId: string;
  /** Nome de exibição da organização — cabeçalho do widget. */
  orgName: string;
}

/**
 * Webchat público (CONTRACTS §6): sessão de visitante com token de escopo
 * restrito, envio de mensagem pelo MESMO pipeline inbound dos demais canais
 * e polling incremental (fallback do socket namespace /webchat).
 * Rotas públicas sem contexto de tenant → prismaSystem com orgId explícito.
 */
@Injectable()
export class WebchatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly inbound: InboundMessageService,
    private readonly realtime: RealtimeService,
    private readonly media: MediaService,
    @InjectQueue(QUEUES.AUTOMATION_RUN)
    private readonly automationRunQueue: Queue<AutomationRunJob>,
  ) {}

  /** POST /api/webchat/session {orgSlug} → {visitorToken, conversationId}. */
  async createSession(dto: CreateWebchatSessionDto): Promise<WebchatSessionDto> {
    const org = await this.prisma.prismaSystem.organization.findUnique({
      where: { slug: dto.orgSlug },
      select: { id: true, name: true },
    });
    if (!org) {
      throw new NotFoundException('Organização não encontrada');
    }

    const channel = await this.prisma.prismaSystem.channel.findFirst({
      where: { orgId: org.id, type: ChannelType.WEBCHAT, status: ChannelStatus.ACTIVE },
      select: { id: true },
    });
    if (!channel) {
      throw new ServiceUnavailableException('Webchat não está habilitado para esta organização');
    }

    const visitorId = randomUUID();
    const contact = await this.inbound.ensureContact({
      orgId: org.id,
      channelType: ChannelType.WEBCHAT,
      externalContactId: visitorId,
      contactName: dto.name,
    });
    const { conversation, created } = await this.inbound.ensureConversation(
      org.id,
      channel.id,
      contact.id,
    );

    if (created) {
      this.realtime.emitConversationNew(org.id, { conversation: toConversationDto(conversation) });
      await this.automationRunQueue.add('conversation.created', {
        orgId: org.id,
        event: 'conversation.created',
        context: {
          conversationId: conversation.id,
          contactId: contact.id,
          channelId: channel.id,
          channelType: ChannelType.WEBCHAT,
        },
      });
    }

    const payload: WebchatTokenPayload = {
      sub: contact.id,
      orgId: org.id,
      channelId: channel.id,
      conversationId: conversation.id,
      scope: 'webchat',
    };
    const visitorToken = await this.jwtService.signAsync(
      { ...payload },
      { expiresIn: VISITOR_TOKEN_TTL },
    );
    return { visitorToken, conversationId: conversation.id, orgName: org.name };
  }

  /** POST /api/webchat/messages — pipeline inbound completo (IA, automações, eventos). */
  async sendMessage(
    visitorToken: string,
    dto: CreateWebchatMessageDto,
  ): Promise<{ message: MessageDto }> {
    const token = await this.verifyToken(visitorToken);
    const type = dto.type ?? MessageType.TEXT;
    const content = this.buildVisitorContent(token.orgId, type, dto);

    const result = await this.inbound.ingestIntoConversation({
      orgId: token.orgId,
      channelId: token.channelId,
      channelType: ChannelType.WEBCHAT,
      conversationId: token.conversationId,
      contactId: token.sub,
      type,
      content,
    });
    if (!result.messageId) {
      throw new NotFoundException('Conversa não encontrada');
    }

    const message = await this.prisma.prismaSystem.message.findFirst({
      where: { id: result.messageId, orgId: token.orgId },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
    });
    if (!message) {
      throw new NotFoundException('Mensagem não encontrada');
    }
    return { message: sanitizeMessageForVisitor(toMessageDto(message)) };
  }

  /**
   * POST /api/webchat/uploads (CONTRACTS §13) — mesmo storeUpload do agente
   * autenticado, tenant-scoped pelo orgId do visitorToken (nunca do body).
   */
  async uploadMedia(visitorToken: string, file: UploadFileInput | undefined): Promise<StoredUpload> {
    const token = await this.verifyToken(visitorToken);
    if (!file) {
      throw new BadRequestException('Arquivo ausente (campo "file")');
    }
    return this.media.storeUpload(token.orgId, file);
  }

  /**
   * Coerência content×type do lado do visitante (mesmo espírito de
   * MessagesService.validateContent): TEXT exige `text` não vazio; tipos de
   * mídia exigem mediaUrl/mimeType E a mediaUrl DEVE apontar para um upload
   * do PRÓPRIO POST /webchat/uploads desta org — o widget não tem (e não
   * deve ganhar) uma aba "por URL" livre, então nunca aceitamos uma mediaUrl
   * arbitrária vinda do visitante.
   */
  private buildVisitorContent(
    orgId: string,
    type: MessageType,
    dto: CreateWebchatMessageDto,
  ): Record<string, unknown> {
    if (type === MessageType.TEXT) {
      const text = dto.text?.trim();
      if (!text) {
        throw new BadRequestException('text é obrigatório para mensagens de texto');
      }
      return { text };
    }

    const mediaUrl = dto.mediaUrl?.trim();
    const mimeType = dto.mimeType?.trim();
    if (!mediaUrl || !mimeType) {
      throw new BadRequestException('mediaUrl e mimeType são obrigatórios para mensagens de mídia');
    }
    const expectedPrefix = `/api/media/${orgId}/uploads/`;
    if (!mediaUrl.startsWith(expectedPrefix)) {
      throw new BadRequestException('mediaUrl inválida — envie o arquivo via POST /api/webchat/uploads');
    }

    const content: Record<string, unknown> = { mediaUrl, mimeType };
    const caption = dto.text?.trim();
    if (caption) {
      content.caption = caption;
    }
    const filename = dto.filename?.trim();
    if (filename) {
      content.filename = filename;
    }
    return content;
  }

  /** GET /api/webchat/messages?after= — mensagens SYSTEM (internas) nunca saem. */
  async listMessages(
    visitorToken: string,
    query: ListWebchatMessagesQuery,
  ): Promise<{ data: MessageDto[] }> {
    const token = await this.verifyToken(visitorToken);

    let afterDate: Date | undefined;
    if (query.after) {
      const anchor = await this.prisma.prismaSystem.message.findFirst({
        where: { id: query.after, orgId: token.orgId, conversationId: token.conversationId },
        select: { createdAt: true },
      });
      afterDate = anchor?.createdAt;
    }

    const messages = await this.prisma.prismaSystem.message.findMany({
      where: {
        orgId: token.orgId,
        conversationId: token.conversationId,
        type: { not: MessageType.SYSTEM },
        ...(afterDate ? { createdAt: { gt: afterDate } } : {}),
      },
      include: { author: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit,
    });
    return { data: messages.map((m) => sanitizeMessageForVisitor(toMessageDto(m))) };
  }

  /** Valida assinatura + escopo do visitorToken. */
  async verifyToken(visitorToken: string): Promise<WebchatTokenPayload> {
    if (!visitorToken) {
      throw new UnauthorizedException('visitorToken ausente');
    }
    try {
      const payload = await this.jwtService.verifyAsync<Partial<WebchatTokenPayload>>(visitorToken);
      if (
        payload.scope !== 'webchat' ||
        !payload.sub ||
        !payload.orgId ||
        !payload.channelId ||
        !payload.conversationId
      ) {
        throw new Error('escopo inválido');
      }
      return payload as WebchatTokenPayload;
    } catch {
      throw new UnauthorizedException('visitorToken inválido ou expirado');
    }
  }
}
