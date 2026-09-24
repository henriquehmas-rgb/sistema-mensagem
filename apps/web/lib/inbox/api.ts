import type {
  ContactDto,
  ConversationDto,
  ConversationStatus,
  DepartmentDto,
  MessageContent,
  MessageDto,
  MessageType,
  PaginatedDto,
  PipelineStageDto,
  ResolutionReasonDto,
  TagDto,
  UserDto,
} from "@sm/shared";

import { api } from "@/lib/api";
import { normalizeFilters } from "./keys";
import {
  CONVERSATIONS_PAGE_SIZE,
  MESSAGES_PAGE_SIZE,
  type ConversationCounts,
  type ConversationFilters,
  type MessagesPage,
} from "./types";

// ---------------------------------------------------------------------------
// Normalização defensiva de listas (rota pode retornar array ou paginado)
// ---------------------------------------------------------------------------

function unwrapList<T>(response: T[] | PaginatedDto<T>): T[] {
  return Array.isArray(response) ? response : response.data;
}

// ---------------------------------------------------------------------------
// Conversas
// ---------------------------------------------------------------------------

function filtersToQuery(
  filters: ConversationFilters,
): Record<string, string | number | undefined> {
  const normalized = normalizeFilters(filters);
  return {
    attention: normalized.attention ? "true" : undefined,
    status: normalized.attention || normalized.status === "ALL" ? undefined : normalized.status,
    q: normalized.q.length > 0 ? normalized.q : undefined,
    channelType: normalized.channelType ?? undefined,
    assigneeId: normalized.assigneeId ?? undefined,
    stageId: normalized.stageId ?? undefined,
    // A API valida tagIds como CSV string (`a,b,c`) — NUNCA como parâmetro
    // repetido (`?tagIds=a&tagIds=b`), que o class-validator rejeita com 400.
    tagIds: normalized.tagIds.length > 0 ? normalized.tagIds.join(",") : undefined,
  };
}

export function listConversations(
  filters: ConversationFilters,
  page: number,
): Promise<PaginatedDto<ConversationDto>> {
  return api.get<PaginatedDto<ConversationDto>>("/conversations", {
    query: {
      ...filtersToQuery(filters),
      page,
      pageSize: CONVERSATIONS_PAGE_SIZE,
    },
  });
}

/** Totais das abas — 4 consultas de pageSize 1 em paralelo (lê só `total`). */
export async function fetchConversationCounts(
  filters: ConversationFilters,
): Promise<ConversationCounts> {
  const base = { ...filtersToQuery(filters), attention: undefined, status: undefined };
  const countFor = async (status: ConversationStatus | undefined): Promise<number> => {
    const response = await api.get<PaginatedDto<ConversationDto>>("/conversations", {
      query: { ...base, status, page: 1, pageSize: 1 },
    });
    return response.total;
  };
  const [open, pending, resolved, all, attention] = await Promise.all([
    countFor("OPEN"),
    countFor("PENDING"),
    countFor("RESOLVED"),
    countFor(undefined),
    api.get<PaginatedDto<ConversationDto>>("/conversations", {
      query: { ...base, status: undefined, attention: "true", page: 1, pageSize: 1 },
    }).then((response) => response.total),
  ]);
  return { open, pending, resolved, all, attention };
}

export function getConversation(id: string): Promise<ConversationDto> {
  return api.get<ConversationDto>(`/conversations/${id}`);
}

export async function listDepartments(): Promise<DepartmentDto[]> {
  const response = await api.get<DepartmentDto[] | PaginatedDto<DepartmentDto>>("/departments");
  return unwrapList(response);
}

export interface UpdateConversationInput {
  status?: ConversationStatus;
  assigneeId?: string | null;
  stageId?: string | null;
  aiEnabled?: boolean;
  departmentId?: string | null;
  resolutionReasonId?: string | null;
  resolutionNote?: string | null;
}

export function updateConversation(
  id: string,
  input: UpdateConversationInput,
): Promise<ConversationDto> {
  return api.patch<ConversationDto>(`/conversations/${id}`, { body: input });
}

export function claimConversation(id: string): Promise<ConversationDto> {
  return api.post<ConversationDto>(`/conversations/${id}/claim`);
}

export function markConversationRead(id: string): Promise<void> {
  return api.post<void>(`/conversations/${id}/read`);
}

export function addConversationTag(
  conversationId: string,
  tagId: string,
): Promise<ConversationDto | void> {
  return api.post<ConversationDto | void>(`/conversations/${conversationId}/tags`, {
    body: { tagId },
  });
}

export function removeConversationTag(
  conversationId: string,
  tagId: string,
): Promise<ConversationDto | void> {
  return api.delete<ConversationDto | void>(
    `/conversations/${conversationId}/tags/${tagId}`,
  );
}

/** GET /contacts/:id — contato + conversas recentes (docs/CONTRACTS.md §6). */
interface ContactDetailDto extends ContactDto {
  conversations?: ConversationDto[];
}

/**
 * Outras conversas do contato — via GET /contacts/:id (a listagem de conversas
 * NÃO aceita `contactId`; com `forbidNonWhitelisted` a API responderia 400).
 */
export async function listContactConversations(
  contactId: string,
): Promise<ConversationDto[]> {
  const response = await api.get<ContactDetailDto>(`/contacts/${contactId}`);
  // Salvaguarda: garante o recorte por contato mesmo se a API mudar a forma.
  return (response.conversations ?? []).filter((c) => c.contactId === contactId);
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

interface CursorPageDto<T> {
  data: T[];
  nextCursor?: string | null;
}

function normalizeMessagesPage(
  response: CursorPageDto<MessageDto> | MessageDto[],
): MessagesPage {
  const data = Array.isArray(response) ? response : response.data;
  const explicitCursor = Array.isArray(response) ? undefined : response.nextCursor;
  // Mensagens vêm mais recentes primeiro; o cursor da próxima página (mais
  // antigas) é o id do último item quando a página veio cheia.
  const fallbackCursor =
    data.length >= MESSAGES_PAGE_SIZE ? (data[data.length - 1]?.id ?? null) : null;
  return { data, nextCursor: explicitCursor !== undefined ? explicitCursor ?? null : fallbackCursor };
}

export async function listMessages(
  conversationId: string,
  cursor: string | null,
): Promise<MessagesPage> {
  const response = await api.get<CursorPageDto<MessageDto> | MessageDto[]>(
    `/conversations/${conversationId}/messages`,
    { query: { cursor: cursor ?? undefined, limit: MESSAGES_PAGE_SIZE } },
  );
  return normalizeMessagesPage(response);
}

export interface SendMessageInput {
  type: MessageType;
  content: MessageContent;
}

export function sendMessage(
  conversationId: string,
  input: SendMessageInput,
): Promise<MessageDto> {
  return api.post<MessageDto>(`/conversations/${conversationId}/messages`, {
    body: input,
  });
}

/** Resposta de POST /uploads (CONTRACTS §13). */
export interface UploadedMediaDto {
  mediaUrl: string;
  mimeType: string;
  filename: string;
  sizeBytes: number;
}

/** POST /uploads — multipart/form-data, campo `file` (anexo do agente na Inbox). */
export function uploadAttachment(file: File): Promise<UploadedMediaDto> {
  const formData = new FormData();
  formData.append("file", file);
  return api.upload<UploadedMediaDto>("/uploads", formData);
}

// ---------------------------------------------------------------------------
// Recursos auxiliares (agentes, etapas, tags, contatos)
// ---------------------------------------------------------------------------

export async function listAgents(): Promise<UserDto[]> {
  const response = await api.get<UserDto[] | PaginatedDto<UserDto>>("/users/agents");
  return unwrapList(response);
}

export async function listStages(): Promise<PipelineStageDto[]> {
  const response = await api.get<PipelineStageDto[] | PaginatedDto<PipelineStageDto>>(
    "/stages",
  );
  return unwrapList(response).sort((a, b) => a.position - b.position);
}

export async function listTags(): Promise<TagDto[]> {
  const response = await api.get<TagDto[] | PaginatedDto<TagDto>>("/tags");
  return unwrapList(response);
}

export async function listResolutionReasons(): Promise<ResolutionReasonDto[]> {
  const response = await api.get<
    ResolutionReasonDto[] | PaginatedDto<ResolutionReasonDto>
  >("/resolution-reasons");
  return unwrapList(response).filter((reason) => reason.isActive);
}

export function createTag(input: { name: string; color: string }): Promise<TagDto> {
  return api.post<TagDto>("/tags", { body: input });
}

export interface UpdateContactInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  customFields?: Record<string, unknown>;
  /** CONTRACTS §15 — `null` limpa a memória de longo prazo (botão "Limpar memória"). */
  memorySummary?: string | null;
}

export function updateContact(
  id: string,
  input: UpdateContactInput,
): Promise<ContactDto> {
  return api.patch<ContactDto>(`/contacts/${id}`, { body: input });
}

export interface IxcCustomerDto {
  id: string;
  name: string;
  tradeName: string | null;
  cpfCnpj: string | null;
  active: boolean | null;
  phone: string | null;
  mobilePhone: string | null;
  whatsapp: string | null;
  email: string | null;
  cityId: string | null;
}

export interface IxcContractDto {
  id: string;
  customerId: string;
  status: string | null;
  internetStatus: string | null;
  planDescription: string | null;
  registeredAt: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  cancelledAt: string | null;
}

export interface IxcInvoiceDto {
  id: string;
  customerId: string;
  contractId: string | null;
  status: string | null;
  dueDate: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  amount: number | null;
  openAmount: number | null;
  paidAmount: number | null;
}

export interface IxcServiceOrderDto {
  id: string;
  customerId: string;
  protocol: string | null;
  status: string | null;
  type: string | null;
  priority: string | null;
  sector: string | null;
  subjectId: string | null;
  openedAt: string | null;
  scheduledAt: string | null;
  closedAt: string | null;
  slaStatus: string | null;
}

export interface IxcConnectionDto {
  id: string;
  customerId: string;
  contractId: string | null;
  active: boolean | null;
  online: boolean | null;
  connectionState: string | null;
  accessType: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  disconnectReason: string | null;
  lastSignal: string | null;
}

export interface IxcCustomerDetailsDto {
  customerId: string;
  contracts: IxcContractDto[];
  invoices: IxcInvoiceDto[] | null;
  serviceOrders: IxcServiceOrderDto[];
  connections: IxcConnectionDto[];
}

export function searchIxcCustomerByPhone(phone: string): Promise<IxcCustomerDto[]> {
  return api.get<IxcCustomerDto[]>("/integrations/ixc/customers/search", {
    query: { phone },
  });
}

export async function getIxcCustomerDetails(
  customerId: string,
  conversationId: string,
  includeInvoices: boolean,
): Promise<IxcCustomerDetailsDto> {
  const encoded = encodeURIComponent(customerId);
  const query = { conversationId };
  const [contracts, serviceOrders, connections, invoices] = await Promise.all([
    api.get<IxcContractDto[]>(`/integrations/ixc/customers/${encoded}/contracts`, { query }),
    api.get<IxcServiceOrderDto[]>(`/integrations/ixc/customers/${encoded}/service-orders`, { query }),
    api.get<IxcConnectionDto[]>(`/integrations/ixc/customers/${encoded}/connections`, { query }),
    includeInvoices
      ? api.get<IxcInvoiceDto[]>(`/integrations/ixc/customers/${encoded}/invoices`, { query })
      : Promise.resolve(null),
  ]);
  return { customerId, contracts, invoices, serviceOrders, connections };
}
