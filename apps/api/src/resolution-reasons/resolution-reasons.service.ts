import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { toResolutionReasonDto, type ResolutionReasonDto } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateResolutionReasonDto } from './dto/create-resolution-reason.dto';
import type { UpdateResolutionReasonDto } from './dto/update-resolution-reason.dto';

@Injectable()
export class ResolutionReasonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ResolutionReasonDto[]> {
    const rows = await this.prisma.tenant.resolutionReason.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    return rows.map(toResolutionReasonDto);
  }

  async create(dto: CreateResolutionReasonDto): Promise<ResolutionReasonDto> {
    const name = dto.name.trim();
    const duplicate = await this.prisma.tenant.resolutionReason.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (duplicate) throw new ConflictException('Já existe um motivo com esse nome');
    const reason = await this.prisma.tenant.resolutionReason.create({
      data: { orgId: this.tenancy.getOrgIdOrThrow(), name },
    });
    await this.audit.log({ action: 'resolution-reason.create', entity: 'ResolutionReason', entityId: reason.id });
    return toResolutionReasonDto(reason);
  }

  async update(id: string, dto: UpdateResolutionReasonDto): Promise<ResolutionReasonDto> {
    const current = await this.prisma.tenant.resolutionReason.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Motivo de encerramento não encontrado');
    const reason = await this.prisma.tenant.resolutionReason.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.audit.log({ action: 'resolution-reason.update', entity: 'ResolutionReason', entityId: id, meta: { fields: Object.keys(dto) } });
    return toResolutionReasonDto(reason);
  }
}
