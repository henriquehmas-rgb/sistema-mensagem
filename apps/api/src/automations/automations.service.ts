import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Automation, AutomationRun, Prisma, RunStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { PaginatedDto } from '../common/serializers';
import type { PaginationQuery } from '../common/dto/pagination.query';
import { PrismaService } from '../prisma/prisma.service';
import { AUTOMATION_EVENTS } from '../queues/queues.constants';
import { TenancyService } from '../tenancy/tenancy.service';
import { AUTOMATION_ACTION_TYPES, parseAction, parseCondition, parseTrigger } from './automation.types';
import type { CreateAutomationDto } from './dto/create-automation.dto';
import type { UpdateAutomationDto } from './dto/update-automation.dto';

export interface AutomationDto {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Record<string, unknown>;
  conditions: unknown[];
  actions: unknown[];
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunDto {
  id: string;
  automationId: string;
  conversationId: string | null;
  status: RunStatus;
  log: Record<string, unknown>;
  durationMs: number;
  createdAt: string;
}

/** CRUD de automações (CONTRACTS §6) — o engine roda no AutomationRunProcessor. */
@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PaginationQuery): Promise<PaginatedDto<AutomationDto>> {
    const [data, total] = await Promise.all([
      this.prisma.tenant.automation.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.tenant.automation.count(),
    ]);
    return {
      data: data.map((automation) => this.toDto(automation)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(dto: CreateAutomationDto): Promise<AutomationDto> {
    this.validateShapes(dto.trigger, dto.conditions, dto.actions);

    const automation = await this.prisma.tenant.automation.create({
      data: {
        // a extension injeta o mesmo orgId em runtime; explícito aqui p/ o type system
        orgId: this.tenancy.getOrgIdOrThrow(),
        name: dto.name,
        enabled: dto.enabled ?? true,
        trigger: dto.trigger as Prisma.InputJsonValue,
        conditions: (dto.conditions ?? []) as Prisma.InputJsonValue,
        actions: dto.actions as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      action: 'automation.create',
      entity: 'Automation',
      entityId: automation.id,
      meta: { name: dto.name },
    });
    return this.toDto(automation);
  }

  async update(id: string, dto: UpdateAutomationDto): Promise<AutomationDto> {
    await this.findOrThrow(id);
    this.validateShapes(dto.trigger, dto.conditions, dto.actions);

    const data: Prisma.AutomationUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.trigger !== undefined) data.trigger = dto.trigger as Prisma.InputJsonValue;
    if (dto.conditions !== undefined) data.conditions = dto.conditions as Prisma.InputJsonValue;
    if (dto.actions !== undefined) data.actions = dto.actions as Prisma.InputJsonValue;

    const automation = await this.prisma.tenant.automation.update({ where: { id }, data });
    await this.audit.log({
      action: 'automation.update',
      entity: 'Automation',
      entityId: id,
      meta: { fields: Object.keys(data) },
    });
    return this.toDto(automation);
  }

  async remove(id: string): Promise<{ success: true }> {
    await this.findOrThrow(id);
    await this.prisma.tenant.automation.delete({ where: { id } });
    await this.audit.log({ action: 'automation.delete', entity: 'Automation', entityId: id });
    return { success: true };
  }

  /** GET /automations/:id/runs — histórico de execuções, mais recentes primeiro. */
  async listRuns(id: string, query: PaginationQuery): Promise<PaginatedDto<AutomationRunDto>> {
    await this.findOrThrow(id);
    const where: Prisma.AutomationRunWhereInput = { automationId: id };
    const [data, total] = await Promise.all([
      this.prisma.tenant.automationRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.tenant.automationRun.count({ where }),
    ]);
    return {
      data: data.map((run) => this.toRunDto(run)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Valida em profundidade as formas Json — payload inválido nunca chega ao engine. */
  private validateShapes(
    trigger: Record<string, unknown> | undefined,
    conditions: unknown[] | undefined,
    actions: unknown[] | undefined,
  ): void {
    if (trigger !== undefined && !parseTrigger(trigger)) {
      throw new BadRequestException(
        `trigger.event deve ser um de: ${AUTOMATION_EVENTS.join(', ')}`,
      );
    }
    for (const [index, condition] of (conditions ?? []).entries()) {
      if (!parseCondition(condition)) {
        throw new BadRequestException(
          `conditions[${index}] inválida — esperado {field, op: eq|neq|contains|exists|not_exists, value?}`,
        );
      }
    }
    for (const [index, action] of (actions ?? []).entries()) {
      if (!parseAction(action)) {
        throw new BadRequestException(
          `actions[${index}] inválida — esperado {type: ${AUTOMATION_ACTION_TYPES.join('|')}, ...}`,
        );
      }
    }
  }

  private async findOrThrow(id: string): Promise<Automation> {
    const automation = await this.prisma.tenant.automation.findUnique({ where: { id } });
    if (!automation) {
      throw new NotFoundException('Automação não encontrada');
    }
    return automation;
  }

  private toDto(automation: Automation): AutomationDto {
    return {
      id: automation.id,
      name: automation.name,
      enabled: automation.enabled,
      trigger: this.asRecord(automation.trigger),
      conditions: Array.isArray(automation.conditions) ? automation.conditions : [],
      actions: Array.isArray(automation.actions) ? automation.actions : [],
      runCount: automation.runCount,
      createdAt: automation.createdAt.toISOString(),
      updatedAt: automation.updatedAt.toISOString(),
    };
  }

  private toRunDto(run: AutomationRun): AutomationRunDto {
    return {
      id: run.id,
      automationId: run.automationId,
      conversationId: run.conversationId,
      status: run.status,
      log: this.asRecord(run.log),
      durationMs: run.durationMs,
      createdAt: run.createdAt.toISOString(),
    };
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
