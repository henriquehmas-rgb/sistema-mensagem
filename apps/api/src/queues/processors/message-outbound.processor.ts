import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MessageStatus, type Channel, type Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import {
  GraphPermanentError,
  MetaGraphService,
} from '../../channels/meta-graph.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { QUEUES, type MessageOutboundJob } from '../queues.constants';

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
 * - INSTAGRAM: envio via Graph API ainda não implementado (ver ARCHITECTURE
 *   "Limitações conhecidas") — comporta-se como dev/demo (SENT imediato).
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
  ) {
    super();
  }

  async process(job: Job<MessageOutboundJob>): Promise<void> {
    const { orgId, messageId } = job.data;

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
        if (!hasCredentials) {
          await this.markSent(orgId, messageId, message.conversationId); // dev/demo
          return;
        }
        await this.sendWhatsApp(orgId, message, channel);
        return;
      }

      case 'INSTAGRAM': {
        if (hasCredentials) {
          this.logger.warn(
            `INSTAGRAM ${messageId}: envio Graph API ainda não implementado (limitação conhecida) — marcando SENT`,
          );
        }
        await this.markSent(orgId, messageId, message.conversationId);
        return;
      }
    }
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
      const result = await this.metaGraph.sendWhatsAppMessage(
        {
          ...credentials,
          phoneNumberId:
            typeof credentials.phoneNumberId === 'string' && credentials.phoneNumberId
              ? credentials.phoneNumberId
              : (channel.externalId ?? ''),
        },
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
    await this.prisma.prismaSystem.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.SENT },
    });
    this.realtime.emitMessageStatus(orgId, {
      messageId,
      conversationId,
      status: MessageStatus.SENT,
    });
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
  }
}
