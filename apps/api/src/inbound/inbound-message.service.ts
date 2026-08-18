import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  Prisma,
  type ChannelType,
  type Contact,
  type MessageType,
} from '@prisma/client';
import { Queue } from 'bullmq';
import {
  conversationInclude,
  messageInclude,
  messagePreview,
  toConversationDto,
  toMessageDto,
  type ConversationWithRelations,
  type MessageWithAuthor,
} from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, type AiReplyJob, type AutomationRunJob } from '../queues/queues.constants';
import { RealtimeService } from '../realtime/realtime.service';

const STAGE_POSITION_GAP = 1_024;
const DEFAULT_CONTACT_NAME = 'Visitante';

export interface InboundIngestInput {
  orgId: string;
  channelId: string;
  channelType: ChannelType;
  /** wa_id / ig user id / webchat visitor id (ContactIdentity.externalId). */
  externalContactId: string;
  contactName?: string;
  contactPhone?: string;
  /** wamid — dedupe via unique(orgId, externalId) de Message. */
  externalMessageId?: string;
  type: MessageType;
  content: Record<string, unknown>;
}

export interface InboundIngestResult {
  duplicate: boolean;
  messageId: string | null;
  conversationId: string | null;
}

/**
 * Fluxo INBOUND (ARCHITECTURE + CONTRACTS §4/§5): resolve Channel→Contact→Conversation
 * (criando o que faltar), grava a Message INBOUND com dedupe por wamid,
 * incrementa unreadCount, emite conversation:new/message:new e enfileira
 * ai-reply + automation-run.
 * Roda FORA de contexto de request (processors/rotas públicas) → prismaSystem
 * SEMPRE com orgId explícito em todos os filtros.
 */
@Injectable()
export class InboundMessageService {
  private readonly logger = new Logger(InboundMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @InjectQueue(QUEUES.AI_REPLY)
    private readonly aiReplyQueue: Queue<AiReplyJob>,
    @InjectQueue(QUEUES.AUTOMATION_RUN)
    private readonly automationRunQueue: Queue<AutomationRunJob>,
  ) {}

  /** Pipeline completo de uma mensagem entrante. */
  async ingest(input: InboundIngestInput): Promise<InboundIngestResult> {
    // Dedupe por wamid ANTES de qualquer efeito colateral (CONTRACTS §4).
    if (input.externalMessageId) {
      const existing = await this.prisma.prismaSystem.message.findFirst({
        where: { orgId: input.orgId, externalId: input.externalMessageId },
        select: { id: true, conversationId: true },
      });
      if (existing) {
        return { duplicate: true, messageId: existing.id, conversationId: existing.conversationId };
      }
    }

    const contact = await this.ensureContact(input);
    const { conversation, created } = await this.ensureConversation(
      input.orgId,
      input.channelId,
      contact.id,
    );

    const message = await this.persistMessage(input, conversation.id);
    if (!message) {
      // corrida no unique(orgId, externalId): outro worker processou o mesmo wamid
      return { duplicate: true, messageId: null, conversationId: conversation.id };
    }

    if (created) {
      this.realtime.emitConversationNew(input.orgId, {
        conversation: toConversationDto(conversation),
      });
      await this.automationRunQueue.add('conversation.created', {
        orgId: input.orgId,
        event: 'conversation.created',
        context: {
          conversationId: conversation.id,
          contactId: contact.id,
          channelId: input.channelId,
          channelType: input.channelType,
        },
      });
    }

    await this.emitMessageNew(input.orgId, conversation.id, message);

    // IA responde apenas conversas com aiEnabled e SEM agente atribuído (ARCHITECTURE §3).
    if (conversation.aiEnabled && !conversation.assigneeId) {
      await this.aiReplyQueue.add('reply', {
        orgId: input.orgId,
        conversationId: conversation.id,
        messageId: message.id,
      });
    }

    await this.automationRunQueue.add('message.inbound', {
      orgId: input.orgId,
      event: 'message.inbound',
      context: {
        conversationId: conversation.id,
        contactId: contact.id,
        channelId: input.channelId,
        channelType: input.channelType,
        messageId: message.id,
        messageType: input.type,
      },
    });

    return { duplicate: false, messageId: message.id, conversationId: conversation.id };
  }

  /**
   * Ingestão em conversa CONHECIDA (webchat: o visitorToken fixa a conversa).
   * Mesmo pipeline de persistência/eventos/filas do ingest(), sem resolução de
   * contato/conversa. Conversa RESOLVED reabre como OPEN ao receber mensagem.
   */
  async ingestIntoConversation(
    input: Pick<
      InboundIngestInput,
      'orgId' | 'channelId' | 'channelType' | 'type' | 'content' | 'externalMessageId'
    > & { conversationId: string; contactId: string },
  ): Promise<InboundIngestResult> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: input.conversationId, orgId: input.orgId },
      select: { id: true, aiEnabled: true, assigneeId: true },
    });
    if (!conversation) {
      return { duplicate: false, messageId: null, conversationId: null };
    }

    const message = await this.persistMessage(
      {
        orgId: input.orgId,
        channelId: input.channelId,
        channelType: input.channelType,
        externalContactId: '',
        externalMessageId: input.externalMessageId,
        type: input.type,
        content: input.content,
      },
      conversation.id,
    );
    if (!message) {
      return { duplicate: true, messageId: null, conversationId: conversation.id };
    }

    await this.emitMessageNew(input.orgId, conversation.id, message);

    if (conversation.aiEnabled && !conversation.assigneeId) {
      await this.aiReplyQueue.add('reply', {
        orgId: input.orgId,
        conversationId: conversation.id,
        messageId: message.id,
      });
    }
    await this.automationRunQueue.add('message.inbound', {
      orgId: input.orgId,
      event: 'message.inbound',
      context: {
        conversationId: conversation.id,
        contactId: input.contactId,
        channelId: input.channelId,
        channelType: input.channelType,
        messageId: message.id,
        messageType: input.type,
      },
    });

    return { duplicate: false, messageId: message.id, conversationId: conversation.id };
  }

  /** Resolve Contact via ContactIdentity, criando contato+identidade se preciso. */
  async ensureContact(
    input: Pick<
      InboundIngestInput,
      'orgId' | 'channelType' | 'externalContactId' | 'contactName' | 'contactPhone'
    >,
  ): Promise<Contact> {
    const identity = await this.prisma.prismaSystem.contactIdentity.findUnique({
      where: {
        orgId_channelType_externalId: {
          orgId: input.orgId,
          channelType: input.channelType,
          externalId: input.externalContactId,
        },
      },
      include: { contact: true },
    });
    if (identity) {
      return identity.contact;
    }

    const contact = await this.findOrCreateContact(input);

    try {
      await this.prisma.prismaSystem.contactIdentity.create({
        data: {
          orgId: input.orgId,
          contactId: contact.id,
          channelType: input.channelType,
          externalId: input.externalContactId,
        },
      });
    } catch (error) {
      // corrida: outro worker criou a mesma identidade — segue com o contato dela
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
    }
    return contact;
  }

  /**
   * Resolve a conversa ativa (não RESOLVED) do contato no canal, criando uma nova
   * na stage default quando não houver. Conversa SNOOZED/PENDING reabre como OPEN
   * ao receber mensagem nova (feito em persistMessage).
   */
  async ensureConversation(
    orgId: string,
    channelId: string,
    contactId: string,
  ): Promise<{ conversation: ConversationWithRelations; created: boolean }> {
    const existing = await this.prisma.prismaSystem.conversation.findFirst({
      where: { orgId, channelId, contactId, status: { not: ConversationStatus.RESOLVED } },
      include: conversationInclude,
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { conversation: existing, created: false };
    }

    const stage = await this.resolveDefaultStage(orgId);
    const stagePosition = stage ? await this.topOfStagePosition(orgId, stage.id) : 0;

    const conversation = await this.prisma.prismaSystem.conversation.create({
      data: {
        orgId,
        channelId,
        contactId,
        status: ConversationStatus.OPEN,
        stageId: stage?.id ?? null,
        stagePosition,
      },
      include: conversationInclude,
    });
    return { conversation, created: true };
  }

  private async persistMessage(
    input: InboundIngestInput,
    conversationId: string,
  ): Promise<MessageWithAuthor | null> {
    const preview = messagePreview(input.type, input.content);
    try {
      return await this.prisma.prismaSystem.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            orgId: input.orgId,
            conversationId,
            direction: MessageDirection.INBOUND,
            type: input.type,
            content: input.content as Prisma.InputJsonValue,
            // INBOUND já chegou até nós — DELIVERED (status PENDING/SENT são do outbound)
            status: MessageStatus.DELIVERED,
            externalId: input.externalMessageId ?? null,
          },
          include: messageInclude,
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: created.createdAt,
            lastMessagePreview: preview,
            unreadCount: { increment: 1 },
            status: ConversationStatus.OPEN, // mensagem nova reabre SNOOZED/PENDING
          },
        });
        return created;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        this.logger.warn(
          `wamid duplicado em corrida (org=${input.orgId}, externalId=${input.externalMessageId ?? '?'})`,
        );
        return null;
      }
      throw error;
    }
  }

  private async findOrCreateContact(
    input: Pick<InboundIngestInput, 'orgId' | 'externalContactId' | 'contactName' | 'contactPhone'>,
  ): Promise<Contact> {
    const phone = input.contactPhone ?? null;
    if (phone) {
      const byPhone = await this.prisma.prismaSystem.contact.findUnique({
        where: { orgId_phone: { orgId: input.orgId, phone } },
      });
      if (byPhone) {
        return byPhone;
      }
    }

    try {
      return await this.prisma.prismaSystem.contact.create({
        data: {
          orgId: input.orgId,
          name: input.contactName?.trim() || phone || DEFAULT_CONTACT_NAME,
          phone,
        },
      });
    } catch (error) {
      // corrida no unique(orgId, phone): outro worker criou — usa o existente
      if (this.isUniqueViolation(error) && phone) {
        const contact = await this.prisma.prismaSystem.contact.findUnique({
          where: { orgId_phone: { orgId: input.orgId, phone } },
        });
        if (contact) {
          return contact;
        }
      }
      throw error;
    }
  }

  private async resolveDefaultStage(orgId: string) {
    const defaultStage = await this.prisma.prismaSystem.pipelineStage.findFirst({
      where: { orgId, isDefault: true },
      orderBy: { position: 'asc' },
    });
    if (defaultStage) {
      return defaultStage;
    }
    return this.prisma.prismaSystem.pipelineStage.findFirst({
      where: { orgId },
      orderBy: { position: 'asc' },
    });
  }

  private async topOfStagePosition(orgId: string, stageId: string): Promise<number> {
    const min = await this.prisma.prismaSystem.conversation.aggregate({
      where: { orgId, stageId },
      _min: { stagePosition: true },
    });
    return (min._min.stagePosition ?? 0) - STAGE_POSITION_GAP;
  }

  private async emitMessageNew(
    orgId: string,
    conversationId: string,
    message: MessageWithAuthor,
  ): Promise<void> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: conversationInclude,
    });
    if (!conversation) {
      return;
    }
    this.realtime.emitMessageNew(orgId, {
      message: toMessageDto(message),
      conversation: toConversationDto(conversation),
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
