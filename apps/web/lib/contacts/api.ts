import type { ContactDto, PaginatedDto, TagDto } from "@sm/shared";

import { api } from "@/lib/api";

export const CONTACTS_PAGE_SIZE = 20;

/**
 * Item da listagem de contatos — a API pode enriquecer com agregados
 * (nº de conversas e tags das conversas). Ausentes → exibidos como "—".
 */
export interface ContactListItemDto extends ContactDto {
  conversationCount?: number;
  tags?: TagDto[];
}

export interface ContactListFilters {
  q: string;
  page: number;
}

/** GET /contacts — busca server-side (`q`) + paginação. */
export function listContacts(
  filters: ContactListFilters,
): Promise<PaginatedDto<ContactListItemDto>> {
  return api.get<PaginatedDto<ContactListItemDto>>("/contacts", {
    query: {
      q: filters.q.trim().length > 0 ? filters.q.trim() : undefined,
      page: filters.page,
      pageSize: CONTACTS_PAGE_SIZE,
    },
  });
}

export function getContact(id: string): Promise<ContactDto> {
  return api.get<ContactDto>(`/contacts/${id}`);
}

export interface CreateContactInput {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export function createContact(input: CreateContactInput): Promise<ContactDto> {
  return api.post<ContactDto>("/contacts", { body: input });
}
