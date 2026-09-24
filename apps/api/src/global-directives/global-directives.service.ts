import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GlobalDirectiveStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateGlobalDirectiveDto } from './dto/create-global-directive.dto';

const TRANSITIONS: Record<GlobalDirectiveStatus, GlobalDirectiveStatus[]> = {
  DRAFT: [GlobalDirectiveStatus.IN_REVIEW],
  IN_REVIEW: [GlobalDirectiveStatus.APPROVED],
  APPROVED: [GlobalDirectiveStatus.ACTIVE],
  ACTIVE: [GlobalDirectiveStatus.SUSPENDED],
  SUSPENDED: [GlobalDirectiveStatus.ACTIVE],
  REPLACED: [],
};

@Injectable()
export class GlobalDirectivesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.tenant.globalDirective.findMany({
      orderBy: [{ priority: 'asc' }, { key: 'asc' }, { version: 'desc' }],
    });
  }

  async create(dto: CreateGlobalDirectiveDto) {
    if (await this.prisma.tenant.globalDirective.findFirst({ where: { key: dto.key } })) {
      throw new ConflictException('A chave já existe; crie uma nova versão');
    }
    return this.persist(dto, 1, 'global_directive.create');
  }

  async createVersion(id: string, dto: CreateGlobalDirectiveDto) {
    const source = await this.find(id);
    if (source.key !== dto.key) throw new BadRequestException('A nova versão deve manter a mesma chave');
    const latest = await this.prisma.tenant.globalDirective.findFirst({
      where: { key: source.key }, orderBy: { version: 'desc' },
    });
    return this.persist(dto, (latest?.version ?? source.version) + 1, 'global_directive.version.create');
  }

  async changeStatus(id: string, target: GlobalDirectiveStatus) {
    const current = await this.find(id);
    if (!TRANSITIONS[current.status].includes(target)) {
      throw new BadRequestException(`Transição inválida: ${current.status} → ${target}`);
    }
    if (target === GlobalDirectiveStatus.ACTIVE) {
      if (!current.owner?.trim()) throw new BadRequestException('Responsável obrigatório');
      if (this.strings(current.principles).length === 0 && this.strings(current.prohibitions).length === 0) {
        throw new BadRequestException('A diretriz precisa possuir ao menos uma regra');
      }
    }
    const updated = await this.prisma.tenant.$transaction(async (tx) => {
      if (target === GlobalDirectiveStatus.ACTIVE) {
        await tx.globalDirective.updateMany({
          where: { key: current.key, status: GlobalDirectiveStatus.ACTIVE, id: { not: id } },
          data: { status: GlobalDirectiveStatus.REPLACED },
        });
      }
      return tx.globalDirective.update({ where: { id }, data: { status: target } });
    });
    await this.audit.log({
      action: 'global_directive.status.change', entity: 'GlobalDirective', entityId: id,
      meta: { from: current.status, to: target },
    });
    return updated;
  }

  private async find(id: string) {
    const row = await this.prisma.tenant.globalDirective.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Diretriz não encontrada');
    return row;
  }

  private async persist(dto: CreateGlobalDirectiveDto, version: number, action: string) {
    const row = await this.prisma.tenant.globalDirective.create({ data: {
      orgId: this.tenancy.getOrgIdOrThrow(), key: dto.key, title: dto.title.trim(),
      category: dto.category.trim(), owner: dto.owner.trim(), priority: dto.priority ?? 100,
      principles: dto.principles.map((item) => item.trim()).filter(Boolean),
      prohibitions: dto.prohibitions.map((item) => item.trim()).filter(Boolean),
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      version, status: GlobalDirectiveStatus.DRAFT,
    } });
    await this.audit.log({ action, entity: 'GlobalDirective', entityId: row.id, meta: { key: row.key, version } });
    return row;
  }

  private strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }
}
