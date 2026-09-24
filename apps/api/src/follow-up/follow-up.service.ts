import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FollowUpStatus, MessageDirection } from '@prisma/client';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, type FollowUpJob } from '../queues/queues.constants';
import type { ReviewFollowUpDto } from './dto/review-follow-up.dto';
import type { ConfigureFollowUpOwnerDto } from './dto/configure-follow-up-owner.dto';
import {
  FOLLOW_UP_DELAYS_MS,
  FOLLOW_UP_DEPARTMENTS,
  isFollowUpConsentAccepted,
  isFollowUpConsentPrompt,
  isFollowUpOptOut,
} from './follow-up.policy';

const LISTABLE_STATUSES = new Set(Object.values(FollowUpStatus));

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.FOLLOW_UP) private readonly followUpQueue: Queue<FollowUpJob>,
  ) {}

  async list(orgId: string, status?: string) {
    const resolvedStatus = status ? this.parseStatus(status) : FollowUpStatus.READY_FOR_REVIEW;
    return this.prisma.prismaSystem.followUpSequence.findMany({
      where: { orgId, status: resolvedStatus },
      orderBy: [{ nextRunAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        conversation: {
          select: {
            id: true, protocol: true, caseSummary: true,
            channel: { select: { id: true, name: true, type: true } },
            contact: { select: { id: true, name: true } },
          },
        },
        responsibleUser: { select: { id: true, name: true, role: true, departmentId: true, isActive: true } },
      },
    });
  }

  async configuration(orgId: string) {
    const organization = await this.prisma.prismaSystem.organization.findUnique({
      where: { id: orgId }, select: { settings: true },
    });
    const settings = this.settingsOf(organization?.settings);
    const configuredId = typeof settings.followUpResponsibleUserId === 'string'
      ? settings.followUpResponsibleUserId
      : null;
    const responsibleUser = configuredId ? await this.prisma.prismaSystem.user.findFirst({
      where: { id: configuredId, orgId, isActive: true },
      select: { id: true, name: true, role: true, departmentId: true },
    }) : null;
    return { responsibleUserId: responsibleUser?.id ?? null, responsibleUser };
  }

  async configureResponsible(dto: ConfigureFollowUpOwnerDto, actor: AuthUser) {
    const responsibleUserId = dto.responsibleUserId?.trim() || null;
    if (responsibleUserId) {
      const user = await this.prisma.prismaSystem.user.findFirst({
        where: { id: responsibleUserId, orgId: actor.orgId, isActive: true }, select: { id: true },
      });
      if (!user) throw new BadRequestException('Responsável de follow-up inválido ou inativo.');
    }
    const organization = await this.prisma.prismaSystem.organization.findUnique({
      where: { id: actor.orgId }, select: { settings: true },
    });
    const settings = this.settingsOf(organization?.settings);
    await this.prisma.prismaSystem.organization.update({
      where: { id: actor.orgId }, data: { settings: { ...settings, followUpResponsibleUserId: responsibleUserId } },
    });
    await this.audit.logSystem(actor.orgId, {
      action: 'follow-up.configuration-updated', entity: 'Organization', entityId: actor.orgId,
      meta: { actorId: actor.userId, responsibleUserId },
    });
    return this.configuration(actor.orgId);
  }

  async review(id: string, dto: ReviewFollowUpDto, actor: AuthUser) {
    const sequence = await this.prisma.prismaSystem.followUpSequence.findFirst({
      where: { id, orgId: actor.orgId },
      select: { id: true, status: true },
    });
    if (!sequence) throw new NotFoundException('Follow-up não encontrado.');
    if (sequence.status !== FollowUpStatus.READY_FOR_REVIEW) {
      throw new BadRequestException('Este follow-up não está disponível para revisão.');
    }
    const status = dto.decision === 'PAUSE' ? FollowUpStatus.PAUSED : FollowUpStatus.CANCELLED;
    const pausedReason = dto.decision === 'PAUSE' ? 'pausado_pela_revisao' : 'cancelado_pela_revisao';
    const updated = await this.prisma.prismaSystem.followUpSequence.update({
      where: { id }, data: { status, pausedReason, nextRunAt: null },
    });
    await this.audit.logSystem(actor.orgId, {
      action: dto.decision === 'PAUSE' ? 'follow-up.review-paused' : 'follow-up.review-cancelled',
      entity: 'FollowUpSequence', entityId: id,
      meta: { actorId: actor.userId, noteProvided: Boolean(dto.note?.trim()) },
    });
    return updated;
  }

  /** Avança somente após a confirmação de envio de uma mensagem humana. */
  async recordHumanDelivery(input: {
    orgId: string; conversationId: string; messageId: string; authorId: string;
  }): Promise<void> {
    const sequence = await this.prisma.prismaSystem.followUpSequence.findFirst({
      where: { orgId: input.orgId, conversationId: input.conversationId, status: FollowUpStatus.READY_FOR_REVIEW },
      select: { id: true, currentStep: true },
    });
    if (!sequence) return;

    const now = new Date();
    if (sequence.currentStep >= FOLLOW_UP_DELAYS_MS.length) {
      await this.prisma.prismaSystem.followUpSequence.update({
        where: { id: sequence.id },
        data: { status: FollowUpStatus.COMPLETED, lastSentAt: now, nextRunAt: null, pausedReason: null },
      });
      await this.audit.logSystem(input.orgId, {
        action: 'follow-up.human-message-completed', entity: 'FollowUpSequence', entityId: sequence.id,
        meta: { messageId: input.messageId, authorId: input.authorId, step: sequence.currentStep, deliveryConfirmed: true },
      });
      return;
    }

    const nextStep = sequence.currentStep + 1;
    const nextRunAt = new Date(now.getTime() + FOLLOW_UP_DELAYS_MS[nextStep - 1]);
    await this.prisma.prismaSystem.followUpSequence.update({
      where: { id: sequence.id },
      data: { status: FollowUpStatus.SCHEDULED, currentStep: nextStep, lastSentAt: now, nextRunAt, pausedReason: null },
    });
    try {
      await this.followUpQueue.add(
        'review',
        { orgId: input.orgId, followUpId: sequence.id, conversationId: input.conversationId, step: nextStep },
        { jobId: `follow-up-${sequence.id}-${nextStep}`, delay: FOLLOW_UP_DELAYS_MS[nextStep - 1] },
      );
    } catch (error) {
      await this.prisma.prismaSystem.followUpSequence.update({
        where: { id: sequence.id },
        data: { status: FollowUpStatus.PAUSED, pausedReason: 'agendamento_indisponivel', nextRunAt: null },
      });
      await this.audit.logSystem(input.orgId, {
        action: 'follow-up.human-message-scheduling-failed', entity: 'FollowUpSequence', entityId: sequence.id,
        meta: { messageId: input.messageId, authorId: input.authorId },
      });
      return;
    }
    await this.audit.logSystem(input.orgId, {
      action: 'follow-up.human-message-confirmed', entity: 'FollowUpSequence', entityId: sequence.id,
      meta: { messageId: input.messageId, authorId: input.authorId, completedStep: sequence.currentStep, scheduledStep: nextStep, deliveryConfirmed: true },
    });
  }

  /**
   * Entrada do cliente pausa a cadência; opt-out a cancela. Quando o contato
   * já está vinculado em mais de um canal, uma resposta em qualquer identidade
   * também pausa a cadência pendente do mesmo contato. Assim WhatsApp e
   * Instagram não disputam atenção nem continuam enviando lembretes depois de
   * a pessoa já ter voltado ao CRM por outro canal.
   */
  async observeInbound(input: {
    orgId: string;
    conversationId: string;
    contactId: string;
    content: Record<string, unknown>;
  }): Promise<void> {
    const text = typeof input.content.text === 'string' ? input.content.text : '';
    if (!text.trim()) return;
    const existing = await this.prisma.prismaSystem.followUpSequence.findFirst({
      where: { orgId: input.orgId, conversationId: input.conversationId },
      select: { id: true, status: true },
    });
    if (existing && (existing.status === FollowUpStatus.SCHEDULED || existing.status === FollowUpStatus.READY_FOR_REVIEW)) {
      const status = isFollowUpOptOut(text) ? FollowUpStatus.CANCELLED : FollowUpStatus.PAUSED;
      const pausedReason = status === FollowUpStatus.CANCELLED ? 'opt_out_do_cliente' : 'cliente_respondeu';
      await this.prisma.prismaSystem.followUpSequence.update({ where: { id: existing.id }, data: { status, pausedReason, nextRunAt: null } });
      await this.audit.logSystem(input.orgId, {
        action: 'follow-up.paused-by-inbound', entity: 'FollowUpSequence', entityId: existing.id,
        meta: { status, pausedReason },
      });
      return;
    }
    if (existing) return;

    const crossChannelActive = await this.prisma.prismaSystem.followUpSequence.findMany({
      where: {
        orgId: input.orgId,
        conversationId: { not: input.conversationId },
        status: { in: [FollowUpStatus.SCHEDULED, FollowUpStatus.READY_FOR_REVIEW] },
        conversation: { contactId: input.contactId },
      },
      select: { id: true },
    });
    if (crossChannelActive.length > 0) {
      const status = isFollowUpOptOut(text) ? FollowUpStatus.CANCELLED : FollowUpStatus.PAUSED;
      const pausedReason = status === FollowUpStatus.CANCELLED
        ? 'opt_out_do_cliente_em_outro_canal'
        : 'cliente_respondeu_em_outro_canal';
      await this.prisma.prismaSystem.followUpSequence.updateMany({
        where: { id: { in: crossChannelActive.map((sequence) => sequence.id) } },
        data: { status, pausedReason, nextRunAt: null },
      });
      await this.audit.logSystem(input.orgId, {
        action: 'follow-up.paused-by-contact-inbound',
        entity: 'FollowUpSequence',
        entityId: input.conversationId,
        meta: { status, pausedReason, sequences: crossChannelActive.length },
      });
      return;
    }

    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: input.conversationId, orgId: input.orgId },
      select: {
        department: { select: { routingKey: true } },
        messages: {
          where: { direction: MessageDirection.OUTBOUND, isAiGenerated: true },
          orderBy: { createdAt: 'desc' }, take: 1, select: { content: true },
        },
      },
    });
    const previous = conversation?.messages[0]?.content as Record<string, unknown> | undefined;
    const previousText = typeof previous?.text === 'string' ? previous.text : '';
    if (!conversation?.department?.routingKey ||
      !FOLLOW_UP_DEPARTMENTS.has(conversation.department.routingKey) ||
      !isFollowUpConsentPrompt(previousText) || !isFollowUpConsentAccepted(text)) return;

    const consentAt = new Date();
    const nextRunAt = new Date(consentAt.getTime() + FOLLOW_UP_DELAYS_MS[0]);
    try {
      const configuration = await this.configuration(input.orgId);
      const sequence = await this.prisma.prismaSystem.followUpSequence.create({
        data: { orgId: input.orgId, conversationId: input.conversationId, status: FollowUpStatus.SCHEDULED, mode: 'REVIEW', currentStep: 1, consentAt, nextRunAt, responsibleUserId: configuration.responsibleUserId },
      });
      await this.followUpQueue.add(
        'review',
        { orgId: input.orgId, followUpId: sequence.id, conversationId: input.conversationId, step: 1 },
        { jobId: `follow-up-${sequence.id}-1`, delay: FOLLOW_UP_DELAYS_MS[0] },
      );
      await this.audit.logSystem(input.orgId, {
        action: 'follow-up.consent-recorded', entity: 'FollowUpSequence', entityId: sequence.id,
        meta: { mode: 'REVIEW', step: 1, department: conversation.department.routingKey, totalSteps: FOLLOW_UP_DELAYS_MS.length, responsibleUserId: configuration.responsibleUserId, externalDeliveryEnabled: false },
      });
    } catch (error) {
      this.logger.warn(`Falha ao criar follow-up controlado: ${(error as Error).message}`);
    }
  }

  private parseStatus(status: string): FollowUpStatus {
    if (!LISTABLE_STATUSES.has(status as FollowUpStatus)) throw new BadRequestException('Status de follow-up inválido.');
    return status as FollowUpStatus;
  }

  private settingsOf(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }
}
