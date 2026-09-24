import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeGapStatus, MessageDirection, MessageStatus, MessageType, Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { QUEUES, type AiReplyJob } from '../queues/queues.constants';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';

export interface CreateKnowledgeGapInput {
  orgId: string;
  conversationId: string;
  departmentId: string | null;
  reason: string;
  question: string;
  context: Prisma.InputJsonObject;
  dueAt?: Date | null;
}

@Injectable()
export class KnowledgeGapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.AI_REPLY) private readonly aiReplyQueue: Queue<AiReplyJob>,
  ) {}

  async list(actor: AuthUser, status?: KnowledgeGapStatus) {
    const departmentId = await this.departmentScope(actor);
    return this.prisma.tenant.knowledgeGap.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(departmentId ? { departmentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        department: { select: { id: true, name: true } },
        responder: { select: { id: true, name: true } },
        conversation: { select: { id: true, protocol: true, caseSummary: true } },
      },
      take: 100,
    });
  }

  async createSystem(input: CreateKnowledgeGapInput) {
    const existing = await this.prisma.prismaSystem.knowledgeGap.findFirst({
      where: { orgId: input.orgId, conversationId: input.conversationId, status: KnowledgeGapStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;
    const gap = await this.prisma.prismaSystem.knowledgeGap.create({ data: input });
    await this.audit.logSystem(input.orgId, {
      action: 'knowledge-gap.created', entity: 'KnowledgeGap', entityId: gap.id,
      meta: { conversationId: input.conversationId, departmentId: input.departmentId, reason: input.reason },
    });
    return gap;
  }

  async answer(id: string, actor: AuthUser, answer: string) {
    const orgId = this.tenancy.getOrgIdOrThrow();
    const gap = await this.prisma.tenant.knowledgeGap.findFirst({ where: { id } });
    if (!gap) throw new NotFoundException('Dúvida interna não encontrada');
    const departmentId = await this.departmentScope(actor);
    if (departmentId && gap.departmentId !== departmentId) {
      throw new ForbiddenException('Esta dúvida pertence a outro setor');
    }
    if (gap.status !== KnowledgeGapStatus.PENDING) {
      throw new BadRequestException('Dúvida interna já foi concluída');
    }
    const trimmed = answer.trim();
    const result = await this.prisma.prismaSystem.$transaction(async (tx) => {
      const updated = await tx.knowledgeGap.update({
        where: { id },
        data: { status: KnowledgeGapStatus.ANSWERED, answer: trimmed, responderId: actor.userId, answeredAt: new Date() },
      });
      const trigger = await tx.message.create({
        data: {
          orgId, conversationId: gap.conversationId, direction: MessageDirection.OUTBOUND,
          type: MessageType.SYSTEM, status: MessageStatus.SENT, authorId: actor.userId,
          content: { text: 'Orientação interna recebida', knowledgeGapId: id },
        },
      });
      return { updated, trigger };
    });
    await this.audit.log({
      action: 'knowledge-gap.answered', entity: 'KnowledgeGap', entityId: id,
      meta: { conversationId: gap.conversationId },
    });
    await this.aiReplyQueue.add('reply-after-gap', {
      orgId, conversationId: gap.conversationId, messageId: result.trigger.id,
    });
    return result.updated;
  }

  /**
   * Fecha um GAP sem orientar o cliente nem reativar a IA. Só liderança pode
   * fazer isso: um AGENT pode responder uma dúvida, mas não removê-la da fila.
   */
  async dismiss(id: string, actor: AuthUser, note: string) {
    if (actor.role !== 'ADMIN' && actor.role !== 'SUPERVISOR') {
      throw new ForbiddenException('Somente ADMIN ou SUPERVISOR pode descartar uma dúvida da IA');
    }
    const gap = await this.prisma.tenant.knowledgeGap.findFirst({ where: { id } });
    if (!gap) throw new NotFoundException('Dúvida interna não encontrada');
    if (gap.status !== KnowledgeGapStatus.PENDING) {
      throw new BadRequestException('Dúvida interna já foi concluída');
    }
    const trimmed = note.trim();
    const updated = await this.prisma.tenant.knowledgeGap.update({
      where: { id },
      data: {
        status: KnowledgeGapStatus.DISMISSED,
        // O schema não tem campo próprio de descarte. A nota permanece somente
        // para auditoria/revisão; o processor lê exclusivamente GAPs ANSWERED.
        answer: trimmed,
        responderId: actor.userId,
        answeredAt: new Date(),
      },
    });
    await this.audit.log({
      action: 'knowledge-gap.dismissed',
      entity: 'KnowledgeGap',
      entityId: id,
      // A justificativa já está no GAP. Evita duplicar texto potencialmente
      // sensível no log de auditoria, que precisa apenas provar a decisão.
      meta: { conversationId: gap.conversationId, noteLength: trimmed.length },
    });
    return updated;
  }

  /** ADMIN/SUPERVISOR enxergam a organização; AGENT somente seu setor ativo. */
  private async departmentScope(actor: AuthUser): Promise<string | null> {
    if (actor.role === 'ADMIN' || actor.role === 'SUPERVISOR') return null;
    const user = await this.prisma.tenant.user.findFirst({
      where: { id: actor.userId, isActive: true, department: { isActive: true } },
      select: { departmentId: true },
    });
    if (!user?.departmentId) {
      throw new ForbiddenException('Defina um setor ativo para responder dúvidas da IA');
    }
    return user.departmentId;
  }
}
