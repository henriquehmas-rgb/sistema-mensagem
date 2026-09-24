import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SalesOpportunityStatus, SalesStageCategory, SalesTaskStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { CreateSalesOpportunityDto } from './dto/create-sales-opportunity.dto';
import { CreateSalesPipelineDto } from './dto/create-sales-pipeline.dto';
import { CreateSalesStageDto } from './dto/create-sales-stage.dto';
import { CreateSalesTaskDto } from './dto/create-sales-task.dto';
import { UpdateSalesOpportunityDto } from './dto/update-sales-opportunity.dto';
import { UpdateSalesTaskDto } from './dto/update-sales-task.dto';

const FINAL_OR_PAUSED = new Set<SalesStageCategory>([
  SalesStageCategory.WON,
  SalesStageCategory.LOST,
  SalesStageCategory.ON_HOLD,
]);

/**
 * Camada comercial sobre Contact/Conversation. Não entrega mensagens, não consulta
 * provedores e não substitui o CRM: apenas registra contexto, próxima ação e trilha.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async listPipelines(actor: AuthUser) {
    const departmentId = await this.actorDepartmentFilter(actor);
    return this.prisma.tenant.salesPipeline.findMany({
      // Agente enxerga somente o funil que pode operar. ADMIN/SUPERVISOR têm
      // visão organizacional para configurar e acompanhar os setores.
      where: departmentId ? { isActive: true, departmentId } : { isActive: true },
      include: { department: { select: { id: true, name: true } }, stages: { orderBy: { position: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async createPipeline(dto: CreateSalesPipelineDto) {
    const departmentId = dto.departmentId ?? null;
    if (departmentId) await this.findDepartment(departmentId);
    const pipeline = await this.prisma.tenant.salesPipeline.create({
      data: { orgId: this.tenancy.getOrgIdOrThrow(), name: dto.name.trim(), departmentId },
    });
    await this.audit.log({ action: 'sales.pipeline.create', entity: 'SalesPipeline', entityId: pipeline.id });
    return pipeline;
  }

  async createStage(pipelineId: string, dto: CreateSalesStageDto) {
    await this.findPipeline(pipelineId);
    const max = await this.prisma.tenant.salesStage.aggregate({ where: { pipelineId }, _max: { position: true } });
    const stage = await this.prisma.tenant.salesStage.create({
      data: {
        orgId: this.tenancy.getOrgIdOrThrow(), pipelineId, name: dto.name.trim(), category: dto.category,
        color: dto.color ?? '#6366f1', position: (max._max.position ?? 0) + 1,
      },
    });
    await this.audit.log({ action: 'sales.stage.create', entity: 'SalesStage', entityId: stage.id, meta: { pipelineId } });
    return stage;
  }

  async listOpportunities(actor: AuthUser) {
    const departmentId = await this.actorDepartmentFilter(actor);
    return this.prisma.tenant.salesOpportunity.findMany({
      where: departmentId ? { departmentId } : {},
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        conversation: { select: { id: true, status: true, channel: { select: { id: true, type: true } } } },
        department: { select: { id: true, name: true } },
        pipeline: { select: { id: true, name: true } },
        stage: { select: { id: true, name: true, category: true, color: true, position: true } },
        assignee: { select: { id: true, name: true } },
        _count: { select: { tasks: true } },
      },
      orderBy: [{ nextActionAt: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async getOpportunity(id: string, actor: AuthUser) {
    const opportunity = await this.prisma.tenant.salesOpportunity.findUnique({
      where: { id },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        conversation: { select: { id: true, status: true, channel: { select: { id: true, type: true } } } },
        department: { select: { id: true, name: true } }, pipeline: true, stage: true,
        assignee: { select: { id: true, name: true } },
        tasks: { include: { assignee: { select: { id: true, name: true } } }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] },
        activities: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!opportunity) throw new NotFoundException('Oportunidade não encontrada');
    await this.assertDepartmentAccess(actor, opportunity.departmentId);
    return opportunity;
  }

  async createOpportunity(dto: CreateSalesOpportunityDto, actor: AuthUser) {
    const [contact, conversation, pipeline, stage] = await Promise.all([
      this.prisma.tenant.contact.findUnique({ where: { id: dto.contactId } }),
      this.prisma.tenant.conversation.findUnique({ where: { id: dto.conversationId } }),
      this.findPipeline(dto.pipelineId),
      this.prisma.tenant.salesStage.findUnique({ where: { id: dto.stageId } }),
    ]);
    if (!contact) throw new NotFoundException('Contato não encontrado');
    if (!conversation) throw new NotFoundException('Conversa não encontrada');
    if (conversation.contactId !== contact.id) throw new BadRequestException('A conversa deve pertencer ao mesmo contato');
    if (!stage || stage.pipelineId !== pipeline.id) throw new BadRequestException('Etapa não pertence ao funil informado');
    if (FINAL_OR_PAUSED.has(stage.category)) throw new BadRequestException('Uma oportunidade deve iniciar em uma etapa ativa');
    await this.assertDepartmentAccess(actor, pipeline.departmentId);
    if (dto.assigneeId) await this.assertAssigneeInDepartment(dto.assigneeId, pipeline.departmentId);

    const opportunity = await this.prisma.tenant.salesOpportunity.create({
      data: {
        orgId: this.tenancy.getOrgIdOrThrow(), contactId: contact.id, conversationId: conversation.id,
        departmentId: pipeline.departmentId, pipelineId: pipeline.id, stageId: stage.id, assigneeId: dto.assigneeId ?? null,
        createdById: actor.userId, title: dto.title.trim(), summary: dto.summary?.trim() || null,
        estimatedValueCents: dto.estimatedValueCents ?? null, nextAction: dto.nextAction?.trim() || null,
        nextActionAt: dto.nextActionAt ? new Date(dto.nextActionAt) : null,
      },
    });
    await this.recordActivity(opportunity.id, actor.userId, 'OPPORTUNITY_CREATED', { stageId: stage.id, pipelineId: pipeline.id });
    await this.audit.log({ action: 'sales.opportunity.create', entity: 'SalesOpportunity', entityId: opportunity.id, meta: { contactId: contact.id, conversationId: conversation.id } });
    return this.getOpportunity(opportunity.id, actor);
  }

  async updateOpportunity(id: string, dto: UpdateSalesOpportunityDto, actor: AuthUser) {
    const current = await this.prisma.tenant.salesOpportunity.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Oportunidade não encontrada');
    await this.assertDepartmentAccess(actor, current.departmentId);

    let stage = null;
    if (dto.stageId) {
      stage = await this.prisma.tenant.salesStage.findUnique({ where: { id: dto.stageId } });
      if (!stage || stage.pipelineId !== current.pipelineId) throw new BadRequestException('Etapa não pertence ao funil da oportunidade');
      if (FINAL_OR_PAUSED.has(stage.category) && !dto.reason?.trim()) {
        throw new BadRequestException('Informe o motivo para concluir, perder ou pausar a oportunidade');
      }
    }
    if (dto.assigneeId !== undefined && dto.assigneeId) await this.assertAssigneeInDepartment(dto.assigneeId, current.departmentId);
    const category = stage?.category;
    const data = {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.summary !== undefined ? { summary: dto.summary?.trim() || null } : {}),
      ...(dto.stageId !== undefined ? { stageId: dto.stageId } : {}),
      ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
      ...(dto.estimatedValueCents !== undefined ? { estimatedValueCents: dto.estimatedValueCents } : {}),
      ...(dto.nextAction !== undefined ? { nextAction: dto.nextAction?.trim() || null } : {}),
      ...(dto.nextActionAt !== undefined ? { nextActionAt: dto.nextActionAt ? new Date(dto.nextActionAt) : null } : {}),
      ...(category === SalesStageCategory.WON ? { status: SalesOpportunityStatus.WON, closedReason: dto.reason!.trim(), closedAt: new Date(), holdReason: null } : {}),
      ...(category === SalesStageCategory.LOST ? { status: SalesOpportunityStatus.LOST, closedReason: dto.reason!.trim(), closedAt: new Date(), holdReason: null } : {}),
      ...(category === SalesStageCategory.ON_HOLD ? { status: SalesOpportunityStatus.ON_HOLD, holdReason: dto.reason!.trim(), closedReason: null, closedAt: null } : {}),
      ...(category && !FINAL_OR_PAUSED.has(category) ? {
        status: SalesOpportunityStatus.OPEN,
        holdReason: null,
        closedReason: null,
        closedAt: null,
      } : {}),
    };
    await this.prisma.tenant.salesOpportunity.update({ where: { id }, data });
    await this.recordActivity(id, actor.userId, 'OPPORTUNITY_UPDATED', { fields: Object.keys(data), stageId: dto.stageId ?? null });
    await this.audit.log({ action: 'sales.opportunity.update', entity: 'SalesOpportunity', entityId: id, meta: { fields: Object.keys(data) } });
    return this.getOpportunity(id, actor);
  }

  async createTask(opportunityId: string, dto: CreateSalesTaskDto, actor: AuthUser) {
    const opportunity = await this.prisma.tenant.salesOpportunity.findUnique({ where: { id: opportunityId } });
    if (!opportunity) throw new NotFoundException('Oportunidade não encontrada');
    await this.assertDepartmentAccess(actor, opportunity.departmentId);
    if (dto.assigneeId) await this.assertAssigneeInDepartment(dto.assigneeId, opportunity.departmentId);
    const task = await this.prisma.tenant.salesTask.create({
      data: { orgId: this.tenancy.getOrgIdOrThrow(), opportunityId, title: dto.title.trim(), assigneeId: dto.assigneeId ?? null, dueAt: dto.dueAt ? new Date(dto.dueAt) : null },
    });
    await this.recordActivity(opportunityId, actor.userId, 'TASK_CREATED', { taskId: task.id });
    await this.audit.log({ action: 'sales.task.create', entity: 'SalesTask', entityId: task.id, meta: { opportunityId } });
    return task;
  }

  async updateTask(id: string, dto: UpdateSalesTaskDto, actor: AuthUser) {
    const task = await this.prisma.tenant.salesTask.findUnique({ where: { id }, include: { opportunity: true } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    await this.assertDepartmentAccess(actor, task.opportunity.departmentId);
    if (dto.assigneeId) await this.assertAssigneeInDepartment(dto.assigneeId, task.opportunity.departmentId);
    const updated = await this.prisma.tenant.salesTask.update({
      where: { id }, data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.status === SalesTaskStatus.COMPLETED ? { completedAt: new Date() } : {}),
        ...(dto.status && dto.status !== SalesTaskStatus.COMPLETED ? { completedAt: null } : {}),
      },
    });
    await this.recordActivity(task.opportunityId, actor.userId, dto.status === SalesTaskStatus.COMPLETED ? 'TASK_COMPLETED' : 'TASK_UPDATED', { taskId: id, status: updated.status });
    await this.audit.log({ action: 'sales.task.update', entity: 'SalesTask', entityId: id, meta: { fields: Object.keys(dto) } });
    return updated;
  }

  async metrics(actor: AuthUser) {
    const departmentId = await this.actorDepartmentFilter(actor);
    const where = departmentId ? { departmentId } : {};
    const [byStatus, withoutNextAction, overdueTasks] = await Promise.all([
      this.prisma.tenant.salesOpportunity.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.tenant.salesOpportunity.count({ where: { ...where, status: SalesOpportunityStatus.OPEN, nextActionAt: null } }),
      this.prisma.tenant.salesTask.count({ where: { status: SalesTaskStatus.OPEN, dueAt: { lt: new Date() }, ...(departmentId ? { opportunity: { departmentId } } : {}) } }),
    ]);
    return { byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })), withoutNextAction, overdueTasks };
  }

  private async findPipeline(id: string) {
    const pipeline = await this.prisma.tenant.salesPipeline.findUnique({ where: { id } });
    if (!pipeline || !pipeline.isActive) throw new NotFoundException('Funil comercial não encontrado ou inativo');
    return pipeline;
  }

  private async findDepartment(id: string) {
    const department = await this.prisma.tenant.department.findUnique({ where: { id } });
    if (!department || !department.isActive) throw new NotFoundException('Departamento não encontrado ou inativo');
    return department;
  }

  private async actorDepartmentFilter(actor: AuthUser): Promise<string | null> {
    if (actor.role === 'ADMIN' || actor.role === 'SUPERVISOR') return null;
    const user = await this.prisma.tenant.user.findUnique({ where: { id: actor.userId }, select: { departmentId: true } });
    if (!user?.departmentId) throw new ForbiddenException('Usuário sem departamento comercial atribuído');
    return user.departmentId;
  }

  private async assertDepartmentAccess(actor: AuthUser, departmentId: string | null) {
    const actorDepartmentId = await this.actorDepartmentFilter(actor);
    if (actorDepartmentId && actorDepartmentId !== departmentId) throw new ForbiddenException('Oportunidade pertence a outro setor');
    if (actorDepartmentId && !departmentId) throw new ForbiddenException('Funil sem setor não pode ser operado por agente');
  }

  private async assertAssigneeInDepartment(assigneeId: string, departmentId: string | null) {
    if (!departmentId) throw new BadRequestException('A atribuição individual requer um setor definido no funil');
    const assignee = await this.prisma.tenant.user.findUnique({ where: { id: assigneeId }, select: { departmentId: true, isActive: true } });
    if (!assignee?.isActive || assignee.departmentId !== departmentId) throw new BadRequestException('Responsável precisa estar ativo no mesmo setor da oportunidade');
  }

  private async recordActivity(opportunityId: string, authorId: string, type: string, metadata: Record<string, unknown>) {
    await this.prisma.tenant.salesActivity.create({
      data: { orgId: this.tenancy.getOrgIdOrThrow(), opportunityId, authorId, type, metadata },
    });
  }
}
