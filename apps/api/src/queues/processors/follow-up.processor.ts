import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConversationStatus, FollowUpStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUES, type FollowUpJob } from '../queues.constants';

/** Transforma a etapa vencida em revisão humana; jamais envia uma mensagem. */
@Processor(QUEUES.FOLLOW_UP)
export class FollowUpProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) { super(); }

  async process(job: Job<FollowUpJob>): Promise<void> {
    const { orgId, followUpId, conversationId, step } = job.data;
    const sequence = await this.prisma.prismaSystem.followUpSequence.findFirst({
      where: { id: followUpId, orgId, conversationId },
      include: {
        conversation: { select: { status: true } },
        responsibleUser: { select: { id: true, isActive: true } },
      },
    });
    if (!sequence || sequence.status !== FollowUpStatus.SCHEDULED || sequence.currentStep !== step) return;
    if (sequence.mode !== 'REVIEW' || sequence.conversation.status !== ConversationStatus.OPEN || (sequence.responsibleUser && !sequence.responsibleUser.isActive)) {
      const pausedReason = sequence.responsibleUser && !sequence.responsibleUser.isActive
        ? 'responsavel_follow_up_inativo'
        : 'conversa_nao_aberta';
      await this.prisma.prismaSystem.followUpSequence.update({
        where: { id: sequence.id },
        data: { status: FollowUpStatus.PAUSED, pausedReason, nextRunAt: null },
      });
      await this.audit.logSystem(orgId, {
        action: 'follow-up.paused-before-review', entity: 'FollowUpSequence', entityId: sequence.id,
        meta: { step, responsibleUserId: sequence.responsibleUser?.id ?? null, conversationStatus: sequence.conversation.status },
      });
      return;
    }
    await this.prisma.prismaSystem.followUpSequence.update({
      where: { id: sequence.id }, data: { status: FollowUpStatus.READY_FOR_REVIEW, nextRunAt: null },
    });
    await this.audit.logSystem(orgId, {
      action: 'follow-up.ready-for-review', entity: 'FollowUpSequence', entityId: sequence.id,
      meta: { step, mode: 'REVIEW', externalDeliveryEnabled: false },
    });
  }
}
