import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConversationStatus, MessageDirection, Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { extractCaseSummary } from '../common/case-summary';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import {
  conversationInclude,
  toConversationDto,
  type ConversationDto,
  type ConversationWithRelations,
  type PaginatedDto,
} from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../queues/ai-service.client';
import { QUEUES, type MemorySummarizeJob } from '../queues/queues.constants';
import { RealtimeService } from '../realtime/realtime.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { MoveConversationDto } from './dto/move-conversation.dto';
import { UNASSIGNED, type ListConversationsQuery } from './dto/list-conversations.query';
import type { UpdateConversationDto } from './dto/update-conversation.dto';

/** Espaçamento padrão entre cards no kanban — média entre vizinhos nunca colide até esgotar o float. */
const STAGE_POSITION_GAP = 1_024;

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly aiService: AiServiceClient,
    @InjectQueue(QUEUES.MEMORY_SUMMARIZE)
    private readonly memorySummarizeQueue: Queue<MemorySummarizeJob>,
  ) {}

  async verifyIdentity(
    id: string,
    method: 'IN_PERSON_CONFIRMED',
    actor: AuthUser,
  ): Promise<ConversationDto> {
    const conversation = await this.get(id, actor);
    const updated = await this.prisma.tenant.conversation.update({
      where: { id: conversation.id },
      data: {
        identityVerifiedAt: new Date(),
        identityVerifiedBy: actor.userId,
        identityVerificationMethod: method,
      },
      include: conversationInclude,
    });
    await this.audit.log({
      action: 'conversation.identity.verify',
      entity: 'Conversation',
      entityId: id,
      meta: { method },
    });
    this.realtime.emitConversationUpdated(updated.orgId, { conversation: toConversationDto(updated) });
    return toConversationDto(updated);
  }

  async revokeIdentity(id: string, actor: AuthUser): Promise<ConversationDto> {
    const conversation = await this.get(id, actor);
    const updated = await this.prisma.tenant.conversation.update({
      where: { id: conversation.id },
      data: {
        identityVerifiedAt: null,
        identityVerifiedBy: null,
        identityVerificationMethod: null,
      },
      include: conversationInclude,
    });
    await this.audit.log({
      action: 'conversation.identity.revoke',
      entity: 'Conversation',
      entityId: id,
      meta: { by: actor.userId },
    });
    this.realtime.emitConversationUpdated(updated.orgId, { conversation: toConversationDto(updated) });
    return toConversationDto(updated);
  }

  /**
   * Enriquece conversas legadas sem produzir resposta, mensagem ou automação.
   * Preserva triagens existentes e limita cada execução para manter a operação previsível.
   */
  async backfillTriage(): Promise<{ processed: number; updated: number; skipped: number; failed: number; remaining: number }> {
    const conversations = await this.prisma.tenant.conversation.findMany({
      where: { OR: [{ caseSummary: null }, { lastIntent: null }] },
      select: {
        id: true,
        caseSummary: true,
        lastIntent: true,
        triageConfidence: true,
        triagedAt: true,
        departmentId: true,
        messages: {
          where: { direction: { in: [MessageDirection.INBOUND, MessageDirection.OUTBOUND] } },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: { direction: true, content: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const conversation of conversations) {
      const messages = conversation.messages.reverse().flatMap((message) => {
        const content = message.content as Record<string, unknown>;
        const text = typeof content.text === 'string' ? content.text.trim() : '';
        return text ? [{
          role: message.direction === MessageDirection.INBOUND ? 'user' as const : 'assistant' as const,
          content: text,
        }] : [];
      });
      if (!messages.some((message) => message.role === 'user')) {
        skipped += 1;
        continue;
      }

      const fallbackSummary = extractCaseSummary(messages);
      try {
      const analysis = await this.aiService.analyzeTriage(messages);
      const routeDepartment = conversation.departmentId || analysis.route_key === 'unrouted' ? null : await this.prisma.tenant.department.findFirst({
        where: { isActive: true, routingKey: analysis.route_key },
        select: { id: true },
      });
      const fallbackDepartment = conversation.departmentId || routeDepartment || analysis.route_key === 'unrouted' ? null : await this.prisma.tenant.department.findFirst({
        where: { isActive: true, isDefault: true },
        select: { id: true },
      });
      await this.prisma.tenant.conversation.update({
        where: { id: conversation.id },
        data: {
          ...(conversation.lastIntent ? {} : {
            lastIntent: analysis.intent,
            secondaryIntent: analysis.secondary_intent ?? null,
            alternativeRouteKey: analysis.alternative_route_key ?? null,
            triageConflict: analysis.conflict_detected === true,
            routingEvidence: analysis.routing_evidence ?? [],
            triageConfidence: Math.max(0, Math.min(1, analysis.triage_confidence)),
            triagedAt: new Date(),
          }),
          ...(conversation.caseSummary ? {} : { caseSummary: analysis.case_summary ?? fallbackSummary }),
          ...(conversation.departmentId ? {} : { departmentId: routeDepartment?.id ?? fallbackDepartment?.id }),
        },
      });
      updated += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`Backfill de triagem falhou para conversa ${conversation.id}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
        if (!conversation.caseSummary && fallbackSummary) {
          await this.prisma.tenant.conversation.update({
            where: { id: conversation.id },
            data: { caseSummary: fallbackSummary },
          });
          updated += 1;
        }
      }
    }

    const remaining = await this.prisma.tenant.conversation.count({
      where: { OR: [{ caseSummary: null }, { lastIntent: null }] },
    });
    return { processed: conversations.length, updated, skipped, failed, remaining };
  }

  /** GET /conversations — todos os filtros do CONTRACTS §6, ordenado por lastMessageAt desc. */
  async list(query: ListConversationsQuery, actor: AuthUser): Promise<PaginatedDto<ConversationDto>> {
    const where: Prisma.ConversationWhereInput = {};

    if (actor.role === 'AGENT') {
      const departmentId = await this.agentDepartmentOrThrow(actor.userId);
      where.departmentId = departmentId;
    }

    if (query.attention) {
      where.status = { not: ConversationStatus.RESOLVED };
      where.assigneeId = null;
      where.OR = [
        { aiEnabled: false },
      ];
    }

    if (query.status && !query.attention) {
      where.status = query.status;
    }
    if (query.assigneeId !== undefined) {
      where.assigneeId = query.assigneeId === UNASSIGNED ? null : query.assigneeId;
    }
    if (query.stageId) {
      where.stageId = query.stageId;
    }
    if (query.channelType) {
      where.channel = { type: query.channelType };
    }
    if (query.tagIds) {
      const tagIds = query.tagIds.split(',').filter((id) => id.length > 0);
      if (tagIds.length > 0) {
        where.tags = { some: { tagId: { in: tagIds } } };
      }
    }
    if (query.q) {
      where.contact = { name: { contains: query.q, mode: 'insensitive' } };
    }

    const [data, total] = await Promise.all([
      this.prisma.tenant.conversation.findMany({
        where,
        include: conversationInclude,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.tenant.conversation.count({ where }),
    ]);

    return {
      data: data.map(toConversationDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(id: string, actor: AuthUser): Promise<ConversationDto> {
    const conversation = await this.findOrThrow(id);
    await this.assertDepartmentAccess(conversation.departmentId, actor);
    return toConversationDto(conversation);
  }

  /** Assunção atômica: somente o primeiro atendente vence a disputa. */
  async claim(id: string, actor: AuthUser): Promise<ConversationDto> {
    const existing = await this.findOrThrow(id);
    await this.assertDepartmentAccess(existing.departmentId, actor);
    if (existing.assigneeId === actor.userId) {
      return toConversationDto(existing);
    }
    if (existing.status === ConversationStatus.RESOLVED) {
      throw new BadRequestException('Reabra a conversa antes de assumir o atendimento');
    }

    const claimed = await this.prisma.tenant.conversation.updateMany({
      where: { id, assigneeId: null, status: { not: ConversationStatus.RESOLVED } },
      data: { assigneeId: actor.userId, aiEnabled: false },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Este atendimento já foi assumido por outra pessoa');
    }

    await this.audit.log({
      action: 'conversation.claim',
      entity: 'Conversation',
      entityId: id,
      meta: { by: actor.userId },
    });
    return this.emitUpdated(id);
  }

  /**
   * PATCH /conversations/:id — assignee/status/stage/aiEnabled + AuditLog.
   * CONTRACTS §15: lê o status ANTERIOR antes do update — transição PARA
   * RESOLVED (de qualquer status que NÃO seja já RESOLVED) enfileira
   * `memory-summarize`. Idempotente: RESOLVED→RESOLVED (nenhuma mudança real,
   * ou reenvio do mesmo PATCH) não re-dispara.
   */
  async update(id: string, dto: UpdateConversationDto, actor: AuthUser): Promise<ConversationDto> {
    const before = await this.findOrThrow(id);
    await this.assertDepartmentAccess(before.departmentId, actor);

    const data: Prisma.ConversationUncheckedUpdateInput = {};

    if (dto.assigneeId !== undefined) {
      if (actor.role === 'AGENT' && dto.assigneeId !== actor.userId) {
        throw new ForbiddenException('Atendentes só podem assumir conversas para si');
      }
      if (dto.assigneeId !== null) {
        const assignee = await this.prisma.tenant.user.findFirst({
          where: { id: dto.assigneeId, isActive: true },
          select: { id: true },
        });
        if (!assignee) {
          throw new BadRequestException('assigneeId não corresponde a um usuário ativo da organização');
        }
      }
      data.assigneeId = dto.assigneeId;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === ConversationStatus.RESOLVED) {
        data.identityVerifiedAt = null;
        data.identityVerifiedBy = null;
        data.identityVerificationMethod = null;
      }
    }
    if (dto.stageId !== undefined) {
      if (dto.stageId !== null) {
        const stage = await this.prisma.tenant.pipelineStage.findFirst({
          where: { id: dto.stageId },
          select: { id: true },
        });
        if (!stage) {
          throw new BadRequestException('stageId não corresponde a uma etapa da organização');
        }
      }
      data.stageId = dto.stageId;
    }
    if (dto.aiEnabled !== undefined) {
      data.aiEnabled = dto.aiEnabled;
    }
    if (dto.departmentId !== undefined) {
      if (dto.departmentId !== null) {
        const department = await this.prisma.tenant.department.findFirst({
          where: { id: dto.departmentId, isActive: true },
          select: { id: true },
        });
        if (!department) {
          throw new BadRequestException(
            'departmentId não corresponde a um departamento ativo da organização',
          );
        }
      }
      data.departmentId = dto.departmentId;
    }
    if (dto.resolutionReasonId !== undefined) {
      if (dto.resolutionReasonId !== null) {
        const reason = await this.prisma.tenant.resolutionReason.findFirst({
          where: { id: dto.resolutionReasonId, isActive: true },
          select: { id: true },
        });
        if (!reason) {
          throw new BadRequestException(
            'resolutionReasonId não corresponde a um motivo ativo da organização',
          );
        }
      }
      data.resolutionReasonId = dto.resolutionReasonId;
    }
    if (dto.resolutionNote !== undefined) {
      data.resolutionNote = dto.resolutionNote?.trim() || null;
    }

    const enteringResolved =
      dto.status === ConversationStatus.RESOLVED && before.status !== ConversationStatus.RESOLVED;
    const reopening =
      dto.status !== undefined &&
      dto.status !== ConversationStatus.RESOLVED &&
      before.status === ConversationStatus.RESOLVED;
    if (enteringResolved) {
      if (!dto.resolutionReasonId) {
        throw new BadRequestException('Selecione um motivo para encerrar o atendimento');
      }
      data.resolvedAt = new Date();
    } else if (reopening) {
      data.resolvedAt = null;
      data.resolutionReasonId = null;
      data.resolutionNote = null;
    }

    await this.prisma.tenant.conversation.update({ where: { id }, data });
    await this.audit.log({
      action: 'conversation.update',
      entity: 'Conversation',
      entityId: id,
      meta: { fields: Object.keys(data), by: actor.userId },
    });

    if (enteringResolved) {
      await this.memorySummarizeQueue.add('summarize', {
        orgId: this.tenancy.getOrgIdOrThrow(),
        contactId: before.contactId,
        conversationId: id,
      });
    }

    return this.emitUpdated(id);
  }

  /** POST /conversations/:id/tags */
  async addTag(id: string, tagId: string): Promise<ConversationDto> {
    await this.findOrThrow(id);
    const tag = await this.prisma.tenant.tag.findFirst({ where: { id: tagId } });
    if (!tag) {
      throw new NotFoundException('Tag não encontrada');
    }
    // ConversationTag não é modelo tenant (m2m puro) — conversa e tag já validadas na org.
    await this.prisma.tenant.conversationTag.upsert({
      where: { conversationId_tagId: { conversationId: id, tagId } },
      create: { conversationId: id, tagId },
      update: {},
    });
    await this.audit.log({
      action: 'conversation.tag.add',
      entity: 'Conversation',
      entityId: id,
      meta: { tagId },
    });
    return this.emitUpdated(id);
  }

  /** DELETE /conversations/:id/tags/:tagId */
  async removeTag(id: string, tagId: string): Promise<ConversationDto> {
    await this.findOrThrow(id);
    await this.prisma.tenant.conversationTag.deleteMany({
      where: { conversationId: id, tagId },
    });
    await this.audit.log({
      action: 'conversation.tag.remove',
      entity: 'Conversation',
      entityId: id,
      meta: { tagId },
    });
    return this.emitUpdated(id);
  }

  /** POST /conversations/:id/read — zera o contador de não lidas. */
  async markRead(id: string): Promise<ConversationDto> {
    await this.findOrThrow(id);
    await this.prisma.tenant.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });
    return this.emitUpdated(id);
  }

  /**
   * POST /conversations/:id/move — kanban (CONTRACTS §6).
   * stagePosition float: o cliente manda a média entre os vizinhos; em caso de
   * colisão exata o server rebalanceia a coluna inteira com espaçamento fixo.
   * Update + detecção de colisão + rebalance rodam em UMA transação SERIALIZABLE
   * (com retry em conflito de serialização) — dois moves concorrentes na mesma
   * coluna não intercalam nem persistem posições duplicadas sem rebalance.
   * Emite conversation:moved, conversation:updated e, após rebalance,
   * conversation:updated para CADA card reposicionado (sem posições stale).
   */
  async move(id: string, dto: MoveConversationDto, actor: AuthUser): Promise<ConversationDto> {
    await this.findOrThrow(id);
    const stage = await this.prisma.tenant.pipelineStage.findFirst({
      where: { id: dto.stageId },
      select: { id: true },
    });
    if (!stage) {
      throw new BadRequestException('stageId não corresponde a uma etapa da organização');
    }

    const { finalPosition, rebalancedIds } = await this.moveInTransaction(id, dto);

    await this.audit.log({
      action: 'conversation.move',
      entity: 'Conversation',
      entityId: id,
      meta: { stageId: dto.stageId, stagePosition: finalPosition },
    });

    const orgId = this.tenancy.getOrgIdOrThrow();
    this.realtime.emitConversationMoved(orgId, {
      conversationId: id,
      stageId: dto.stageId,
      stagePosition: finalPosition,
      movedBy: actor.userId,
    });
    if (rebalancedIds.length > 0) {
      await this.emitRebalanced(orgId, rebalancedIds, id);
    }
    return this.emitUpdated(id);
  }

  /** Move atômico com retry em conflito de serialização (P2034). */
  private async moveInTransaction(
    id: string,
    dto: MoveConversationDto,
  ): Promise<{ finalPosition: number; rebalancedIds: string[] }> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.tenant.$transaction(
          async (tx) => {
            await tx.conversation.update({
              where: { id },
              data: { stageId: dto.stageId, stagePosition: dto.stagePosition },
            });

            const collisions = await tx.conversation.count({
              where: { stageId: dto.stageId, stagePosition: dto.stagePosition, id: { not: id } },
            });
            if (collisions === 0) {
              return { finalPosition: dto.stagePosition, rebalancedIds: [] };
            }

            // Rebalance da coluna inteira com espaçamento fixo, preservando a ordem
            // atual (empate por updatedAt desc — o card recém-movido fica ACIMA
            // daquele com quem colidiu).
            const conversations = await tx.conversation.findMany({
              where: { stageId: dto.stageId },
              select: { id: true },
              orderBy: [{ stagePosition: 'asc' }, { updatedAt: 'desc' }],
            });

            let movedPosition = STAGE_POSITION_GAP;
            const rebalancedIds: string[] = [];
            for (const [index, conversation] of conversations.entries()) {
              const position = (index + 1) * STAGE_POSITION_GAP;
              if (conversation.id === id) {
                movedPosition = position;
              } else {
                rebalancedIds.push(conversation.id);
              }
              await tx.conversation.update({
                where: { id: conversation.id },
                data: { stagePosition: position },
              });
            }
            return { finalPosition: movedPosition, rebalancedIds };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const serializationConflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
        if (!serializationConflict || attempt >= MAX_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  /** Após rebalance: cada card reposicionado ganha conversation:updated (posição fresca). */
  private async emitRebalanced(
    orgId: string,
    rebalancedIds: string[],
    movedId: string,
  ): Promise<void> {
    const conversations = await this.prisma.tenant.conversation.findMany({
      where: { id: { in: rebalancedIds.filter((cid) => cid !== movedId) } },
      include: conversationInclude,
    });
    for (const conversation of conversations) {
      this.realtime.emitConversationUpdated(orgId, {
        conversation: toConversationDto(conversation),
      });
    }
  }

  private async emitUpdated(id: string): Promise<ConversationDto> {
    const conversation = await this.findOrThrow(id);
    const dto = toConversationDto(conversation);
    this.realtime.emitConversationUpdated(this.tenancy.getOrgIdOrThrow(), { conversation: dto });
    return dto;
  }

  private async agentDepartmentOrThrow(userId: string): Promise<string> {
    const user = await this.prisma.tenant.user.findFirst({
      where: { id: userId, isActive: true },
      select: { departmentId: true },
    });
    if (!user?.departmentId) {
      throw new ForbiddenException('Atendente sem setor configurado. Procure um administrador.');
    }
    return user.departmentId;
  }

  private async assertDepartmentAccess(departmentId: string | null, actor: AuthUser): Promise<void> {
    if (actor.role !== 'AGENT') return;
    const agentDepartmentId = await this.agentDepartmentOrThrow(actor.userId);
    if (!departmentId || departmentId !== agentDepartmentId) {
      throw new ForbiddenException('Este atendimento pertence a outro setor');
    }
  }

  private async findOrThrow(id: string): Promise<ConversationWithRelations> {
    const conversation = await this.prisma.tenant.conversation.findUnique({
      where: { id },
      include: conversationInclude,
    });
    if (!conversation) {
      throw new NotFoundException('Conversa não encontrada');
    }
    return conversation;
  }
}
