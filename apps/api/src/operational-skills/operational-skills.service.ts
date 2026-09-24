import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationalSkillStatus, type Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateOperationalSkillDto } from './dto/create-operational-skill.dto';
import { actionRequiresHumanReview } from '../operational-actions/commercial-action-policy';

const TRANSITIONS: Record<OperationalSkillStatus, OperationalSkillStatus[]> = {
  DRAFT: [OperationalSkillStatus.IN_REVIEW],
  IN_REVIEW: [OperationalSkillStatus.DRAFT, OperationalSkillStatus.APPROVED],
  APPROVED: [OperationalSkillStatus.ACTIVE, OperationalSkillStatus.DRAFT],
  ACTIVE: [OperationalSkillStatus.SUSPENDED],
  SUSPENDED: [OperationalSkillStatus.ACTIVE, OperationalSkillStatus.REPLACED],
  REPLACED: [],
};

@Injectable()
export class OperationalSkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  list(status?: OperationalSkillStatus) {
    return this.prisma.tenant.operationalSkill.findMany({
      where: status ? { status } : undefined,
      include: { department: { select: { id: true, name: true, routingKey: true } } },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
  }

  async get(id: string) {
    const skill = await this.prisma.tenant.operationalSkill.findUnique({
      where: { id },
      include: { department: { select: { id: true, name: true, routingKey: true } } },
    });
    if (!skill) throw new NotFoundException('Skill operacional não encontrada');
    return skill;
  }

  async create(dto: CreateOperationalSkillDto) {
    const duplicate = await this.prisma.tenant.operationalSkill.findFirst({ where: { key: dto.key } });
    if (duplicate) throw new ConflictException('A chave já existe; crie uma nova versão');
    await this.assertDepartment(dto.departmentId);
    const skill = await this.prisma.tenant.operationalSkill.create({ data: this.toData(dto, 1) });
    await this.audit.log({ action: 'operational_skill.create', entity: 'OperationalSkill', entityId: skill.id });
    return skill;
  }

  async createVersion(sourceId: string, dto: CreateOperationalSkillDto) {
    const source = await this.get(sourceId);
    if (dto.key !== source.key) throw new BadRequestException('Uma nova versão deve manter a mesma chave');
    await this.assertDepartment(dto.departmentId);
    const latest = await this.prisma.tenant.operationalSkill.findFirst({
      where: { key: source.key },
      orderBy: { version: 'desc' },
    });
    const skill = await this.prisma.tenant.operationalSkill.create({
      data: this.toData(dto, (latest?.version ?? source.version) + 1),
    });
    await this.audit.log({
      action: 'operational_skill.version.create',
      entity: 'OperationalSkill',
      entityId: skill.id,
      meta: { sourceId, version: skill.version },
    });
    return skill;
  }

  async changeStatus(id: string, target: OperationalSkillStatus) {
    const current = await this.get(id);
    if (!TRANSITIONS[current.status].includes(target)) {
      throw new BadRequestException(`Transição inválida: ${current.status} → ${target}`);
    }
    if (target === OperationalSkillStatus.ACTIVE) this.assertReadyForActivation(current);

    const skill = await this.prisma.tenant.$transaction(async (tx) => {
      if (target === OperationalSkillStatus.ACTIVE) {
        await tx.operationalSkill.updateMany({
          where: { key: current.key, status: OperationalSkillStatus.ACTIVE, id: { not: id } },
          data: { status: OperationalSkillStatus.REPLACED },
        });
      }
      return tx.operationalSkill.update({ where: { id }, data: { status: target } });
    });
    await this.audit.log({
      action: 'operational_skill.status.change',
      entity: 'OperationalSkill',
      entityId: id,
      meta: { from: current.status, to: target },
    });
    return skill;
  }

  private async assertDepartment(departmentId?: string): Promise<void> {
    if (!departmentId) return;
    const department = await this.prisma.tenant.department.findUnique({ where: { id: departmentId } });
    if (!department?.isActive) throw new BadRequestException('Departamento inexistente ou inativo');
  }

  private assertReadyForActivation(skill: {
    owner: string | null;
    allowedSources: unknown;
    protocolSteps: unknown;
    allowedActions: unknown;
    reviewConditions: unknown;
    validUntil: Date | null;
  }): void {
    const sources = this.stringList(skill.allowedSources);
    const steps = this.stringList(skill.protocolSteps);
    const actions = this.stringList(skill.allowedActions);
    const reviews = this.stringList(skill.reviewConditions);
    if (!skill.owner?.trim()) throw new BadRequestException('Defina um responsável antes de ativar');
    if (sources.length === 0) {
      throw new BadRequestException('Defina as fontes permitidas; use * somente após revisão consciente');
    }
    if (steps.length === 0) throw new BadRequestException('Defina ao menos uma etapa do protocolo');
    if (skill.validUntil && skill.validUntil.getTime() <= Date.now()) {
      throw new BadRequestException('A validade da skill já expirou');
    }
    if (actions.some(actionRequiresHumanReview) && reviews.length === 0) {
      throw new BadRequestException('Ações comerciais sensíveis exigem condição explícita de revisão humana');
    }
  }

  private stringList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  }

  private toData(dto: CreateOperationalSkillDto, version: number): Prisma.OperationalSkillUncheckedCreateInput {
    return {
      orgId: this.tenancy.getOrgIdOrThrow(),
      key: dto.key,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      departmentId: dto.departmentId ?? null,
      owner: dto.owner?.trim() || null,
      version,
      status: OperationalSkillStatus.DRAFT,
      identityRequirement: dto.identityRequirement ?? 'NONE',
      minimumConfidence: dto.minimumConfidence ?? 0.8,
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      triggerConditions: dto.triggerConditions ?? [],
      requiredData: dto.requiredData ?? [],
      allowedSources: dto.allowedSources ?? [],
      protocolSteps: dto.protocolSteps ?? [],
      allowedActions: dto.allowedActions ?? [],
      forbiddenActions: dto.forbiddenActions ?? [],
      completionCriteria: dto.completionCriteria ?? [],
      reviewConditions: dto.reviewConditions ?? [],
      humanHandoffConditions: dto.humanHandoffConditions ?? [],
    };
  }
}
