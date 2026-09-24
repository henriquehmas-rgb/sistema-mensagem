import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
import type { MergeContactDto } from './dto/merge-contact.dto';
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

  /**
   * Consolida um contato duplicado sob o contato-alvo já escolhido por um
   * administrador. Não há heurística: a confirmação do operador é obrigatória.
   * As conversas e as identidades de canal são transferidas numa transação; o
   * contato de origem só é removido quando não resta relação dependente.
   *
   * Duas memórias persistentes não são concatenadas automaticamente, pois isso
   * pode mesclar fatos de pessoas distintas. Se ambas existirem, a operação é
   * bloqueada para revisão humana; se apenas a origem tiver memória, ela é
   * preservada no contato-alvo.
   */
  async mergeInto(targetId: string, dto: MergeContactDto): Promise<ContactDto> {
    if (!dto.confirm) {
      throw new BadRequestException('Confirmação explícita é obrigatória para mesclar contatos');
    }
    if (targetId === dto.sourceContactId) {
      throw new BadRequestException('O contato de origem deve ser diferente do contato de destino');
    }

    const [target, source] = await Promise.all([
      this.findOrThrow(targetId),
      this.findOrThrow(dto.sourceContactId),
    ]);
    if (target.memorySummary && source.memorySummary) {
      throw new ConflictException(
        'Os dois contatos têm memória persistente. Revise e consolide a memória antes de mesclar.',
      );
    }

    const orgId = this.tenancy.getOrgIdOrThrow();
    const transferred = await this.prisma.prismaSystem.$transaction(async (tx) => {
      const [identities, conversations] = await Promise.all([
        tx.contactIdentity.updateMany({
          where: { orgId, contactId: source.id },
          data: { contactId: target.id },
        }),
        tx.conversation.updateMany({
          where: { orgId, contactId: source.id },
          data: { contactId: target.id },
        }),
      ]);
      const updated = await tx.contact.update({
        where: { id: target.id },
        data: source.memorySummary && !target.memorySummary
          ? { memorySummary: source.memorySummary, memoryUpdatedAt: source.memoryUpdatedAt ?? new Date() }
          : {},
      });
      await tx.contact.delete({ where: { id: source.id } });
      return { updated, identities: identities.count, conversations: conversations.count };
    });

    await this.audit.log({
      action: 'contact.merge',
      entity: 'Contact',
      entityId: target.id,
      meta: {
        sourceContactId: source.id,
        identitiesTransferred: transferred.identities,
        conversationsTransferred: transferred.conversations,
        memoryTransferred: Boolean(source.memorySummary && !target.memorySummary),
        reason: dto.reason?.trim() || undefined,
      },
    });
    const result = toContactDto(transferred.updated);
    this.realtime.emitContactUpdated(orgId, { contact: result });
    return result;
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
