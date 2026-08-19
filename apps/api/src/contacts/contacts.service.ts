import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Contact } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  conversationInclude,
  toContactDto,
  toConversationDto,
  type ContactDto,
  type ConversationDto,
  type PaginatedDto,
} from '../common/serializers';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TenancyService } from '../tenancy/tenancy.service';
import type { CreateContactDto } from './dto/create-contact.dto';
import type { ListContactsQuery } from './dto/list-contacts.query';
import type { UpdateContactDto } from './dto/update-contact.dto';

const RECENT_CONVERSATIONS = 5;

export interface ContactDetailDto extends ContactDto {
  conversations: ConversationDto[];
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListContactsQuery): Promise<PaginatedDto<ContactDto>> {
    const where: Prisma.ContactWhereInput = query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { phone: { contains: query.q, mode: 'insensitive' } },
            { email: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.tenant.contact.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.tenant.contact.count({ where }),
    ]);

    return {
      data: data.map(toContactDto),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** GET /contacts/:id — contato + conversas recentes (CONTRACTS §6). */
  async get(id: string): Promise<ContactDetailDto> {
    const contact = await this.findOrThrow(id);
    const conversations = await this.prisma.tenant.conversation.findMany({
      where: { contactId: id },
      include: conversationInclude,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: RECENT_CONVERSATIONS,
    });
    return {
      ...toContactDto(contact),
      conversations: conversations.map(toConversationDto),
    };
  }

  async create(dto: CreateContactDto): Promise<ContactDto> {
    try {
      const contact = await this.prisma.tenant.contact.create({
        data: {
          // a extension injeta o mesmo orgId em runtime; explícito aqui p/ o type system
          orgId: this.tenancy.getOrgIdOrThrow(),
          name: dto.name,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          avatarUrl: dto.avatarUrl ?? null,
          notes: dto.notes ?? null,
          customFields: (dto.customFields ?? {}) as Prisma.InputJsonValue,
        },
      });
      await this.audit.log({ action: 'contact.create', entity: 'Contact', entityId: contact.id });
      return toContactDto(contact);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  async update(id: string, dto: UpdateContactDto): Promise<ContactDto> {
    await this.findOrThrow(id);

    const data: Prisma.ContactUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.customFields !== undefined) {
      data.customFields = dto.customFields as Prisma.InputJsonValue;
    }
    if (dto.memorySummary !== undefined) {
      // CONTRACTS §15: `null` explícito é o botão "Limpar memória" da UI —
      // zera também memoryUpdatedAt (não há "atualizado há X" sem resumo).
      data.memorySummary = dto.memorySummary;
      data.memoryUpdatedAt = dto.memorySummary === null ? null : new Date();
    }

    try {
      const contact = await this.prisma.tenant.contact.update({ where: { id }, data });
      await this.audit.log({
        action: 'contact.update',
        entity: 'Contact',
        entityId: id,
        meta: { fields: Object.keys(data) },
      });
      this.realtime.emitContactUpdated(this.tenancy.getOrgIdOrThrow(), {
        contact: toContactDto(contact),
      });
      return toContactDto(contact);
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  private async findOrThrow(id: string): Promise<Contact> {
    const contact = await this.prisma.tenant.contact.findUnique({ where: { id } });
    if (!contact) {
      throw new NotFoundException('Contato não encontrado');
    }
    return contact;
  }

  private mapUniqueViolation(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Já existe um contato com este telefone nesta organização');
    }
    return error as Error;
  }
}
