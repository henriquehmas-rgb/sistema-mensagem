import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MessageDirection, MessageStatus, MessageType, type Channel, type Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import {
  GraphPermanentError,
  MetaGraphService,
} from '../../channels/meta-graph.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FollowUpService } from '../../follow-up/follow-up.service';
import { OMNI_OPERATIONAL_POLICY } from '../../operational-policy/omni-operational-policy';
import { RealtimeService } from '../../realtime/realtime.service';
import { OperationalIncidentsService } from '../../operational-incidents/operational-incidents.service';
import { QUEUES, type MessageOutboundJob } from '../queues.constants';
import { bubbleGapMs, typingDelayMs } from '../whatsapp-humanization';

type OutboundMessage = Prisma.MessageGetPayload<{
  include: { conversation: { select: { id: true; channelId: true; contactId: true } } };
}>;

/**
 * Processor `message-outbound` (CONTRACTS §4): entrega mensagens OUTBOUND ao canal.
 * - WEBCHAT: a entrega real é o próprio Socket.io (message:new já alcançou o
 *   visitante via relay do namespace /webchat) → marca SENT e emite message:status.
 * - WHATSAPP: com credenciais → envio real via Meta Graph API (Cloud API); grava
 *   o wamid em externalId e aguarda sent/delivered/read via webhook. Sem
 *   credenciais (dev/demo) → marca SENT imediatamente.
 * - INSTAGRAM: com credenciais → envio real via Graph API (POST
 *   /{ig_business_id}/messages, recipient = ContactIdentity INSTAGRAM); grava o
 *   message_id em externalId; READ chega via webhook (messaging[].read). Sem
 *   credenciais (dev/demo) → marca SENT imediatamente.
 * Erros permanentes (4xx/config) → FAILED; transientes (rede/5xx) → throw p/ retry.
 * Sem contexto de request → prismaSystem SEMPRE filtrando orgId do payload.
 */
@Processor(QUEUES.MESSAGE_OUTBOUND)
export class MessageOutboundProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageOutboundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly metaGraph: MetaGraphService,
    private readonly followUp: FollowUpService,
    private readonly operationalIncidents: OperationalIncidentsService,
  ) {
    super();
  }

  async process(job: Job<MessageOutboundJob>): Promise<void> {
    const { orgId, messageId } = job.data;
    if (job.data.turnMessageIds?.length) {
      const ids = [...new Set(job.data.turnMessageIds)];
      const first = await this.prisma.prismaSystem.message.findFirst({
        where: { id: ids[0], orgId },
        select: { conversation: { select: { channelId: true } } },
      });
      const channel = first && await this.prisma.prismaSystem.channel.findFirst({
        where: { id: first.conversation.channelId, orgId }, select: { type: true },
      });
      const paceWhatsApp = channel?.type === 'WHATSAPP';
      for (let index = 0; index < ids.length; index++) {
        await this.process({ data: { orgId, messageId: ids[index]! } } as Job<MessageOutboundJob>);
        if (paceWhatsApp && index < ids.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, bubbleGapMs(ids[index]!)));
        }
      }
      return;
    }

    const message: OutboundMessage | null = await this.prisma.prismaSystem.message.findFirst({
      where: { id: messageId, orgId },
      include: { conversation: { select: { id: true, channelId: true, contactId: true } } },
    });
    if (!message) {
      this.logger.warn(`Mensagem ${messageId} não encontrada (org=${orgId}) — job descartado`);
      return;
    }
    if (message.status !== MessageStatus.PENDING) {
      return; // idempotência: retry de job já processado
    }

    const channel = await this.prisma.prismaSystem.channel.findFirst({
      where: { id: message.conversation.channelId, orgId },
    });
    if (!channel) {
      await this.markFailed(orgId, messageId, message.conversationId, 'Canal não encontrado');
      return;
    }

    const hasCredentials = channel.encryptedCredentials.length > 0;

    switch (channel.type) {
      case 'WEBCHAT':
        // Entrega do webchat é via socket — o evento message:new já alcançou o visitante.
        await this.markSent(orgId, messageId, message.conversationId);
        return;

      case 'WHATSAPP': {
        if (!this.isExternalDeliveryEnabledFor(channel)) {
          await this.markFailed(
            orgId,
            messageId,
            message.conversationId,
            'Entrega externa bloqueada: canal fora do escopo do piloto controlado',
          );
          return;
        }
        if (!hasCredentials) {
          await this.markSent(orgId, messageId, message.conversationId); // dev/demo
          return;
        }
        await this.sendWhatsApp(orgId, message, channel);
        return;
      }

      case 'INSTAGRAM': {
        if (!this.isExternalDeliveryEnabledFor(channel)) {
          await this.markFailed(
            orgId,
            messageId,
            message.conversationId,
            'Entrega externa bloqueada: canal fora do escopo do piloto controlado',
          );
          return;
        }
        if (!hasCredentials) {
          await this.markSent(orgId, messageId, message.conversationId); // dev/demo
          return;
        }
        await this.sendInstagram(orgId, message, channel);
        return;
      }
    }
  }

  private isExternalDeliveryEnabledFor(channel: Channel): boolean {
    return OMNI_OPERATIONAL_POLICY.externalChannelDeliveryEnabled
      && channel.type === 'WHATSAPP'
      && typeof channel.externalId === 'string'
      && OMNI_OPERATIONAL_POLICY.externalChannelDeliveryAllowedExternalIds.includes(channel.externalId);
  }

  /** Envio real via WhatsApp Cloud API — wamid vai para Message.externalId. */
  private async sendWhatsApp(
    orgId: string,
    message: OutboundMessage,
    channel: Channel,
  ): Promise<void> {
    const credentials = this.metaGraph.decryptCredentials(channel);
    if (!credentials) {
      await this.markFailed(
        orgId,
        message.id,
        message.conversationId,
        'Credenciais do canal indecifráveis — reconfigure o canal',
      );
      return;
    }

    const to = await this.resolveRecipient(orgId, message.conversation.contactId);
    if (!to) {
      await this.markFailed(
        orgId,
        message.id,
        message.conversationId,
        'Contato sem wa_id/telefone para entrega no WhatsApp',
      );
      return;
    }

    try {
      const effectiveCredentials = {
        ...credentials,
        phoneNumberId: typeof credentials.phoneNumberId === 'string' && credentials.phoneNumberId
          ? credentials.phoneNumberId : (channel.externalId ?? ''),
      };
      if (message.isAiGenerated && message.type === MessageType.TEXT) {
        const content = message.content as Record<string, unknown>;
        const triggerId = typeof content.turnTriggerId === 'string' ? content.turnTriggerId : null;
        const inbound = await this.prisma.prismaSystem.message.findFirst({
          where: triggerId
            ? { id: triggerId, orgId, conversationId: message.conversationId, direction: MessageDirection.INBOUND }
            : { orgId, conversationId: message.conversationId, direction: MessageDirection.INBOUND },
          select: { externalId: true },
          ...(!triggerId ? { orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] } : {}),
        });
        if (inbound?.externalId?.startsWith('wamid.')) {
          try {
            await this.metaGraph.setWhatsAppReadState(effectiveCredentials, inbound.externalId, true);
          } catch {
            this.logger.warn('Indicador de digitacao WhatsApp indisponivel; envio continua');
          }
        }
        await new Promise((resolve) => setTimeout(
          resolve,
          typingDelayMs(typeof content.text === 'string' ? content.text : '', message.id),
        ));
      }
      const result = await this.metaGraph.sendWhatsAppMessage(
        effectiveCredentials,
        to,
        message.type,
        typeof message.content === 'object' && message.content !== null
          ? (message.content as Record<string, unknown>)
          : {},
      );
      await this.prisma.prismaSystem.message.update({
        where: { id: message.id },
        data: { status: MessageStatus.SENT, externalId: result.externalId },
      });
      this.realtime.emitMessageStatus(orgId, {
        messageId: message.id,
        conversationId: message.conversationId,
        status: MessageStatus.SENT,
      });
    } catch (error) {
      if (error instanceof GraphPermanentError) {
        await this.markFailed(orgId, message.id, message.conversationId, error.message);
        return;
      }
      throw error; // transiente (rede/5xx) → BullMQ retry com backoff
    }
  }

  /** Envio real via Instagram Direct (Graph API) — message_id vai para externalId. */
  private async sendInstagram(
    orgId: string,
    message: OutboundMessage,
    channel: Channel,
  ): Promise<void> {
    const credentials = this.metaGraph.decryptCredentials(channel);
    if (!credentials) {
      await this.markFailed(
        orgId,
        message.id,
        message.conversationId,
        'Credenciais do canal indecifráveis — reconfigure o canal',
      );
      return;
    }

    const recipientId = await this.resolveInstagramRecipient(orgId, message.conversation.contactId);
    if (!recipientId) {
      await this.markFailed(
        orgId,
        message.id,
        message.conversationId,
        'Contato sem identidade Instagram para entrega no Direct',
      );
      return;
    }

    try {
      const result = await this.metaGraph.sendInstagramMessage(
        {
          ...credentials,
          // ig business id pode vir das credenciais ou do externalId do canal
          igBusinessId:
            typeof credentials.igBusinessId === 'string' && credentials.igBusinessId
              ? credentials.igBusinessId
              : (channel.externalId ?? ''),
        },
        recipientId,
        message.type,
        typeof message.content === 'object' && message.content !== null
          ? (message.content as Record<string, unknown>)
          : {},
      );
      await this.prisma.prismaSystem.message.update({
        where: { id: message.id },
        data: { status: MessageStatus.SENT, externalId: result.externalId },
      });
      this.realtime.emitMessageStatus(orgId, {
        messageId: message.id,
        conversationId: message.conversationId,
        status: MessageStatus.SENT,
      });
    } catch (error) {
      if (error instanceof GraphPermanentError) {
        await this.markFailed(orgId, message.id, message.conversationId, error.message);
        return;
      }
      throw error; // transiente (rede/5xx) → BullMQ retry com backoff
    }
  }

  /** IGSID do contato — ContactIdentity INSTAGRAM (sem fallback: IG não usa telefone). */
  private async resolveInstagramRecipient(orgId: string, contactId: string): Promise<string | null> {
    const identity = await this.prisma.prismaSystem.contactIdentity.findFirst({
      where: { orgId, contactId, channelType: 'INSTAGRAM' },
      select: { externalId: true },
    });
    return identity?.externalId ?? null;
  }

  /** wa_id da ContactIdentity (preferido) ou telefone do contato, só dígitos. */
  private async resolveRecipient(orgId: string, contactId: string): Promise<string | null> {
    const identity = await this.prisma.prismaSystem.contactIdentity.findFirst({
      where: { orgId, contactId, channelType: 'WHATSAPP' },
      select: { externalId: true },
    });
    if (identity?.externalId) {
      return identity.externalId;
    }
    const contact = await this.prisma.prismaSystem.contact.findFirst({
      where: { id: contactId, orgId },
      select: { phone: true },
    });
    const digits = contact?.phone?.replace(/\D/g, '') ?? '';
    return digits.length > 0 ? digits : null;
  }

  private async markSent(orgId: string, messageId: string, conversationId: string): Promise<void> {
    const delivered = await this.prisma.prismaSystem.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.SENT },
      select: { authorId: true, isAiGenerated: true },
    });
    this.realtime.emitMessageStatus(orgId, {
      messageId,
      conversationId,
      status: MessageStatus.SENT,
    });
    if (delivered.authorId && !delivered.isAiGenerated) {
      await this.followUp.recordHumanDelivery({ orgId, conversationId, messageId, authorId: delivered.authorId });
    }
  }

  private async markFailed(
    orgId: string,
    messageId: string,
    conversationId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.prismaSystem.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.FAILED, errorMessage },
    });
    this.realtime.emitMessageStatus(orgId, {
      messageId,
      conversationId,
      status: MessageStatus.FAILED,
    });
    if (OMNI_OPERATIONAL_POLICY.externalChannelDeliveryEnabled
      && !errorMessage.startsWith('Entrega externa bloqueada')) {
      await this.operationalIncidents.record({
        orgId,
        source: 'CHANNEL_DELIVERY',
        code: 'external_delivery_failed',
        severity: 'P2',
      });
    }
  }
}
