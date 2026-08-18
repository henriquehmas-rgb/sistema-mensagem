import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Tag } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { toTagDto, type TagDto } from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateTagDto } from './dto/create-tag.dto';
import type { UpdateTagDto } from './dto/update-tag.dto';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<TagDto[]> {
    const tags = await this.prisma.tenant.tag.findMany({ orderBy: { name: 'asc' } });
    return tags.map(toTagDto);
  }

  async create(dto: CreateTagDto): Promise<TagDto> {
    try {
      const tag = await this.prisma.tenant.tag.create({
        // a extension injeta o mesmo orgId em runtime; explícito aqui p/ o type system
        data: { orgId: this.tenancy.getOrgIdOrThrow(), name: dto.name, color: dto.color },
      });
      await this.audit.log({ action: 'tag.create', entity: 'Tag', entityId: tag.id });
      return toTagDto(tag);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async update(id: string, dto: UpdateTagDto): Promise<TagDto> {
    await this.findOrThrow(id);
    const data: Prisma.TagUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.color !== undefined) data.color = dto.color;

    try {
      const tag = await this.prisma.tenant.tag.update({ where: { id }, data });
      await this.audit.log({
        action: 'tag.update',
        entity: 'Tag',
        entityId: id,
        meta: { fields: Object.keys(data) },
      });
      return toTagDto(tag);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async remove(id: string): Promise<{ success: true }> {
    await this.findOrThrow(id);
    // ConversationTag em cascata (schema) — remove os vínculos junto.
    await this.prisma.tenant.tag.delete({ where: { id } });
    await this.audit.log({ action: 'tag.delete', entity: 'Tag', entityId: id });
    return { success: true };
  }

  private async findOrThrow(id: string): Promise<Tag> {
    const tag = await this.prisma.tenant.tag.findUnique({ where: { id } });
    if (!tag) {
      throw new NotFoundException('Tag não encontrada');
    }
    return tag;
  }

  private mapUniqueViolation(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe uma tag com este nome nesta organização');
    }
    return error as Error;
  }
}
