import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConversationStatus, FollowUpStatus, MessageDirection, MessageStatus, MessageType } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { AuditService } from '../../audit/audit.service';
import { messagePreview } from '../../common/serializers';
import { OMNI_OPERATIONAL_POLICY } from '../../operational-policy/omni-operational-policy';
import { PrismaService } from '../../prisma/prisma.service';
import {
  QUEUES,
  type ConversationInactivityJob,
  type MemorySummarizeJob,
  type MessageOutboundJob,
} from '../queues.constants';

const INACTIVITY_REASON = 'Inatividade';
const INACTIVITY_NOTE = 'Encerrada automaticamente após 30 minutos sem interação.';
const INACTIVITY_CLOSING_TEXT =
  'Como não tivemos novas mensagens, vou encerrar este atendimento por enquanto. Quando precisar, envie uma nova mensagem por aqui e começamos de novo.';
const WHATSAPP_FREE_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * Resolve conversas inativas do canal-piloto. Não cria ou envia Message,
 * não consulta o IXC e usa update condicional para não vencer uma mensagem
 * que chegou durante a própria varredura.
 */
@Processor(QUEUES.CONVERSATION_INACTIVITY)
export class ConversationInactivityProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.MEMORY_SUMMARIZE)
    private readonly memorySummarizeQueue: Queue<MemorySummarizeJob>,
    @InjectQueue(QUEUES.MESSAGE_OUTBOUND)
    private readonly messageOutboundQueue: Queue<MessageOutboundJob>,
  ) {
    super();
  }

  async process(_job: Job<ConversationInactivityJob>): Promise<void> {
    const policy = OMNI_OPERATIONAL_POLICY.conversationInactivity;
    if (!policy.enabled || policy.allowedChannelExternalIds.length === 0) return;

    const now = new Date();
    const cutoff = new Date(now.getTime() - policy.inactivityMinutes * 60_000);
    const candidates = await this.prisma.prismaSystem.conversation.findMany({
      where: {
        status: { in: [ConversationStatus.OPEN, ConversationStatus.PENDING] },
        assigneeId: null,
        aiEnabled: true,
        lastMessageAt: { lt: cutoff },
        channel: { externalId: { in: [...policy.allowedChannelExternalIds] } },
      },
      select: { id: true, orgId: true, contactId: true },
      take: 100,
    });

    for (const candidate of candidates) {
      const reason = await this.prisma.prismaSystem.resolutionReason.upsert({
        where: { orgId_name: { orgId: candidate.orgId, name: INACTIVITY_REASON } },
        create: { orgId: candidate.orgId, name: INACTIVITY_REASON, isActive: true },
        update: { isActive: true },
        select: { id: true },
      });
      const resolved = await this.prisma.prismaSystem.conversation.updateMany({
        where: {
          id: candidate.id,
          orgId: candidate.orgId,
          status: { in: [ConversationStatus.OPEN, ConversationStatus.PENDING] },
          assigneeId: null,
          aiEnabled: true,
          lastMessageAt: { lt: cutoff },
          channel: { externalId: { in: [...policy.allowedChannelExternalIds] } },
        },
        data: {
          status: ConversationStatus.RESOLVED,
          resolutionReasonId: reason.id,
          resolutionNote: INACTIVITY_NOTE,
          resolvedAt: now,
          identityVerifiedAt: null,
          identityVerifiedBy: null,
          identityVerificationMethod: null,
        },
      });
      if (resolved.count !== 1) continue;

      await this.prisma.prismaSystem.followUpSequence.updateMany({
        where: {
          orgId: candidate.orgId,
          conversationId: candidate.id,
          status: { in: [FollowUpStatus.SCHEDULED, FollowUpStatus.READY_FOR_REVIEW] },
        },
        data: { status: FollowUpStatus.PAUSED, pausedReason: 'conversa_encerrada_por_inatividade', nextRunAt: null },
      });
      await this.audit.logSystem(candidate.orgId, {
        action: 'conversation.resolved-by-inactivity',
        entity: 'Conversation',
        entityId: candidate.id,
        meta: { inactivityMinutes: policy.inactivityMinutes, channelPilotOnly: true },
      });
      await this.memorySummarizeQueue.add('summarize', {
        orgId: candidate.orgId,
        contactId: candidate.contactId,
        conversationId: candidate.id,
      });
      await this.enqueueClosingMessageWhenInsideWhatsAppWindow(candidate, now);
    }
  }

  /**
   * O encerramento sempre acontece internamente. A despedida é enviada só
   * quando a última entrada da pessoa ainda está na janela livre de 24h da
   * Meta; depois disso, texto comum seria rejeitado sem template homologado.
   */
  private async enqueueClosingMessageWhenInsideWhatsAppWindow(
    candidate: { id: string; orgId: string },
    now: Date,
  ): Promise<void> {
    const lastInbound = await this.prisma.prismaSystem.message.findFirst({
      where: { orgId: candidate.orgId, conversationId: candidate.id, direction: MessageDirection.INBOUND },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (!lastInbound || now.getTime() - lastInbound.createdAt.getTime() > WHATSAPP_FREE_CONVERSATION_WINDOW_MS) {
      await this.audit.logSystem(candidate.orgId, {
        action: 'conversation.inactivity-closing-message.skipped-outside-whatsapp-window',
        entity: 'Conversation',
        entityId: candidate.id,
        meta: { templateUsed: false },
      });
      return;
    }

    const message = await this.prisma.prismaSystem.message.create({
      data: {
        orgId: candidate.orgId,
        conversationId: candidate.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        status: MessageStatus.PENDING,
        content: { text: INACTIVITY_CLOSING_TEXT },
        isAiGenerated: true,
      },
      select: { id: true, createdAt: true },
    });
    await this.prisma.prismaSystem.conversation.update({
      where: { id: candidate.id },
      data: {
        lastMessageAt: message.createdAt,
        lastMessagePreview: messagePreview(MessageType.TEXT, { text: INACTIVITY_CLOSING_TEXT }),
      },
    });
    await this.messageOutboundQueue.add('deliver', { orgId: candidate.orgId, messageId: message.id });
    await this.audit.logSystem(candidate.orgId, {
      action: 'conversation.inactivity-closing-message.queued',
      entity: 'Conversation',
      entityId: candidate.id,
      meta: { templateUsed: false },
    });
  }
}
