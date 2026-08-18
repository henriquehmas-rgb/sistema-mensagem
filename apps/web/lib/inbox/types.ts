import type { ChannelType, ConversationStatus, MessageDto } from "@sm/shared";

/** Aba de status da lista — os 3 status principais + "Todas". */
export type StatusTab = Extract<ConversationStatus, "OPEN" | "PENDING" | "RESOLVED"> | "ALL";

/**
 * Sentinela para o filtro "Não atribuídas" — enviado como `assigneeId=unassigned`
 * na query string (a API interpreta como `assigneeId IS NULL`).
 */
export const UNASSIGNED = "unassigned";

/** Filtros da lista de conversas (docs/CONTRACTS.md §6 — GET /conversations). */
export interface ConversationFilters {
  status: StatusTab;
  q: string;
  channelType: ChannelType | null;
  /** id do agente, {@link UNASSIGNED} ("Não atribuídas") ou null (todos). */
  assigneeId: string | null;
  stageId: string | null;
  tagIds: string[];
}

export const DEFAULT_FILTERS: ConversationFilters = {
  status: "OPEN",
  q: "",
  channelType: null,
  assigneeId: null,
  stageId: null,
  tagIds: [],
};

/** Página de mensagens — cursor pagination, mais recentes primeiro (§6). */
export interface MessagesPage {
  data: MessageDto[];
  nextCursor: string | null;
}

/** Contadores das abas de status (respeitam busca + filtros ativos). */
export interface ConversationCounts {
  open: number;
  pending: number;
  resolved: number;
  all: number;
}

export const CONVERSATIONS_PAGE_SIZE = 25;
export const MESSAGES_PAGE_SIZE = 30;

/** Prefixo de ids de mensagens otimistas (ainda não confirmadas pela API). */
export const OPTIMISTIC_ID_PREFIX = "tmp-";

export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}
