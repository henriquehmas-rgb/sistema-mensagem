import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PipelineStage, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { toStageDto, type PipelineStageDto } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateStageDto } from './dto/create-stage.dto';
import type { ReorderStagesDto } from './dto/reorder-stages.dto';
import type { UpdateStageDto } from './dto/update-stage.dto';

@Injectable()
export class StagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<PipelineStageDto[]> {
    const stages = await this.prisma.tenant.pipelineStage.findMany({
      orderBy: { position: 'asc' },
    });
    return stages.map(toStageDto);
  }

  async create(dto: CreateStageDto): Promise<PipelineStageDto> {
    const max = await this.prisma.tenant.pipelineStage.aggregate({
      _max: { position: true },
    });
    const stage = await this.prisma.tenant.pipelineStage.create({
      data: {
        // a extension injeta o mesmo orgId em runtime; explícito aqui p/ o type system
        orgId: this.tenancy.getOrgIdOrThrow(),
        name: dto.name,
        color: dto.color,
        position: (max._max.position ?? 0) + 1,
        isHumanHandoff: dto.isHumanHandoff ?? false,
        isDefault: dto.isDefault ?? false,
      },
    });
    await this.audit.log({ action: 'stage.create', entity: 'PipelineStage', entityId: stage.id });
    return toStageDto(stage);
  }

  async update(id: string, dto: UpdateStageDto): Promise<PipelineStageDto> {
    await this.findOrThrow(id);
    const data: Prisma.PipelineStageUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.isHumanHandoff !== undefined) data.isHumanHandoff = dto.isHumanHandoff;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    const stage = await this.prisma.tenant.pipelineStage.update({ where: { id }, data });
    await this.audit.log({
      action: 'stage.update',
      entity: 'PipelineStage',
      entityId: id,
      meta: { fields: Object.keys(data) },
    });
    return toStageDto(stage);
  }

  /** Etapa com conversas não pode ser removida (CONTRACTS §6) → 409. */
  async remove(id: string): Promise<{ success: true }> {
    await this.findOrThrow(id);
    const inUse = await this.prisma.tenant.conversation.count({ where: { stageId: id } });
    if (inUse > 0) {
      throw new ConflictException(
        `Etapa possui ${inUse} conversa(s) — mova-as antes de excluir`,
      );
    }
    await this.prisma.tenant.pipelineStage.delete({ where: { id } });
    await this.audit.log({ action: 'stage.delete', entity: 'PipelineStage', entityId: id });
    return { success: true };
  }

  /** POST /stages/reorder {ids} — recalcula position pela ordem recebida. */
  async reorder(dto: ReorderStagesDto): Promise<PipelineStageDto[]> {
    const stages = await this.prisma.tenant.pipelineStage.findMany({ select: { id: true } });
    const known = new Set(stages.map((stage) => stage.id));
    if (dto.ids.length !== known.size || !dto.ids.every((id) => known.has(id))) {
      throw new BadRequestException('ids deve conter exatamente todas as etapas da organização');
    }

    await this.prisma.tenant.$transaction(async (tx) => {
      for (const [index, id] of dto.ids.entries()) {
        await tx.pipelineStage.update({ where: { id }, data: { position: index + 1 } });
      }
    });
    await this.audit.log({
      action: 'stage.reorder',
      entity: 'PipelineStage',
      entityId: '*',
      meta: { ids: dto.ids },
    });
    return this.list();
  }

  private async findOrThrow(id: string): Promise<PipelineStage> {
    const stage = await this.prisma.tenant.pipelineStage.findUnique({ where: { id } });
    if (!stage) {
      throw new NotFoundException('Etapa não encontrada');
    }
    return stage;
  }
}
