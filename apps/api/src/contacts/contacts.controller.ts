import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { ContactDto, PaginatedDto } from '../common/serializers';
import { ContactsService, type ContactDetailDto } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { ListContactsQuery } from './dto/list-contacts.query';
import { UpdateContactDto } from './dto/update-contact.dto';

/**
 * RBAC (CONTRACTS §15 pede revisão): diferente de tags/automations/knowledge/
 * channels/stages — configuração restrita a ADMIN|SUPERVISOR — dados de
 * contato (nome/telefone/notas/customFields e, agora, memorySummary) são
 * operação corrente de qualquer AGENT no atendimento (crm-panel.tsx e a
 * página /contacts editam via este mesmo PATCH), o mesmo padrão já usado em
 * PATCH /conversations/:id (também sem @Roles). Mantido aberto a todo
 * autenticado de propósito — restringir a ADMIN|SUPERVISOR quebraria a edição
 * inline do painel do contato para agentes.
 */
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(@Query() query: ListContactsQuery): Promise<PaginatedDto<ContactDto>> {
    return this.contactsService.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ContactDetailDto> {
    return this.contactsService.get(id);
  }

  @Post()
  create(@Body() dto: CreateContactDto): Promise<ContactDto> {
    return this.contactsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateContactDto): Promise<ContactDto> {
    return this.contactsService.update(id, dto);
  }
}
