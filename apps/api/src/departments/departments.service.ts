import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { toDepartmentDto, type DepartmentDto } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<DepartmentDto[]> {
    const rows = await this.prisma.tenant.department.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    return rows.map(toDepartmentDto);
  }

  async create(dto: CreateDepartmentDto): Promise<DepartmentDto> {
    const name = dto.name.trim();
    const duplicate = await this.prisma.tenant.department.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (duplicate) throw new ConflictException('Já existe um departamento com esse nome');
    const department = await this.prisma.tenant.$transaction(async (tx) => {
      if (dto.isDefault) await tx.department.updateMany({ data: { isDefault: false } });
      return tx.department.create({ data: { orgId: this.tenancy.getOrgIdOrThrow(), name, description: dto.description?.trim() || null, color: dto.color ?? '#6366f1', isDefault: dto.isDefault ?? false } });
    });
    await this.audit.log({ action: 'department.create', entity: 'Department', entityId: department.id });
    return toDepartmentDto(department);
  }

  async update(id: string, dto: UpdateDepartmentDto): Promise<DepartmentDto> {
    const current = await this.prisma.tenant.department.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Departamento não encontrado');
    const data: Prisma.DepartmentUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
      ...(dto.color !== undefined ? { color: dto.color } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
    };
    const department = await this.prisma.tenant.$transaction(async (tx) => {
      if (dto.isDefault) await tx.department.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
      return tx.department.update({ where: { id }, data });
    });
    await this.audit.log({ action: 'department.update', entity: 'Department', entityId: id, meta: { fields: Object.keys(data) } });
    return toDepartmentDto(department);
  }
}
