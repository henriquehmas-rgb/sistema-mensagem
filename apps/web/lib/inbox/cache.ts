import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import type {
  ContactDto,
  ConversationDto,
  MessageDto,
  MessageStatus,
  PaginatedDto,
} from "@sm/shared";

import { inboxKeys, type NormalizedFilters } from "./keys";
import { UNASSIGNED, isOptimisticId, type MessagesPage } from "./types";

type ConversationsInfinite = InfiniteData<PaginatedDto<ConversationDto>, number>;
type MessagesInfinite = InfiniteData<MessagesPage, string | null>;

// ---------------------------------------------------------------------------
// Predicado de filtros (para decidir se uma conversa entra em cada lista)
// ---------------------------------------------------------------------------

/**
 * Precisa espelhar EXATAMENTE a semântica do servidor
 * (apps/api/src/conversations/conversations.service.ts), senão os upserts do
 * realtime inserem/removem conversas em desacordo com o que a API retornaria:
 * - tagIds: conversa com QUALQUER uma das tags (`tagId IN (...)`);
 * - q: busca APENAS pelo nome do contato (contains, case-insensitive).
 */
export function conversationMatchesFilters(
  conversation: ConversationDto,
  filters: NormalizedFilters,
): boolean {
  if (filters.status !== "ALL" && conversation.status !== filters.status) return false;
  if (filters.channelType && conversation.channelType !== filters.channelType) {
    return false;
  }
  if (filters.assigneeId === UNASSIGNED) {
    if (conversation.assigneeId !== null) return false;
  } else if (filters.assigneeId && conversation.assigneeId !== filters.assigneeId) {
    return false;
  }
  if (filters.stageId && conversation.stageId !== filters.stageId) return false;
  if (filters.tagIds.length > 0) {
    const tagIds = new Set(conversation.tags.map((tag) => tag.id));
    if (!filters.tagIds.some((id) => tagIds.has(id))) return false;
  }
  if (filters.q.length > 0) {
    const q = filters.q.toLowerCase();
    if (!conversation.contact.name.toLowerCase().includes(q)) return false;
  }
  return true;
}

function isNormalizedFilters(value: unknown): value is NormalizedFilters {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "tagIds" in value
  );
}

// ---------------------------------------------------------------------------
// Conversas — upsert/patch em todas as listas + detail cacheado
// ---------------------------------------------------------------------------

/**
 * Insere/atualiza a conversa em todas as listas em cache: remove das páginas,
 * reinsere no topo da primeira página quando corresponde aos filtros da lista
 * (comportamento "reordena por atividade") e atualiza o cache de detalhe.
 */
export function upsertConversationInCaches(
  queryClient: QueryClient,
  conversation: ConversationDto,
): void {
  const listQueries = queryClient.getQueriesData<ConversationsInfinite>({
    queryKey: inboxKeys.conversationLists,
  });

  for (const [queryKey, data] of listQueries) {
    if (!data) continue;
    const filters = queryKey[2];
    if (!isNormalizedFilters(filters)) continue;

    const existed = data.pages.some((page) =>
      page.data.some((item) => item.id === conversation.id),
    );
    const matches = conversationMatchesFilters(conversation, filters);
    if (!existed && !matches) continue;

    queryClient.setQueryData<ConversationsInfinite>(queryKey, (current) => {
      if (!current) return current;
      const pages = current.pages.map((page) => ({
        ...page,
        data: page.data.filter((item) => item.id !== conversation.id),
      }));
      let total = Math.max(0, (pages[0]?.total ?? 0) - (existed ? 1 : 0));
      if (matches) {
        const first = pages[0];
        if (first) {
          pages[0] = { ...first, data: [conversation, ...first.data] };
        }
        total += 1;
      }
      return {
        ...current,
        pages: pages.map((page) => ({ ...page, total })),
      };
    });
  }

  // Detail: só atualiza se já existe em cache (não cria entrada fantasma).
  if (queryClient.getQueryData(inboxKeys.conversation(conversation.id)) !== undefined) {
    queryClient.setQueryData(inboxKeys.conversation(conversation.id), conversation);
  }

  // Lista "outras conversas" do contato.
  const byContact = queryClient.getQueryData<ConversationDto[]>(
    inboxKeys.contactConversations(conversation.contactId),
  );
  if (byContact) {
    const rest = byContact.filter((item) => item.id !== conversation.id);
    queryClient.setQueryData(
      inboxKeys.contactConversations(conversation.contactId),
      [conversation, ...rest],
    );
  }
}

/** Patch parcial de uma conversa (por id) em todas as listas + detail. */
export function patchConversationInCaches(
  queryClient: QueryClient,
  conversationId: string,
  patch: Partial<ConversationDto>,
): void {
  const apply = (item: ConversationDto): ConversationDto =>
    item.id === conversationId ? { ...item, ...patch } : item;

  const listQueries = queryClient.getQueriesData<ConversationsInfinite>({
    queryKey: inboxKeys.conversationLists,
  });
  for (const [queryKey, data] of listQueries) {
    if (!data) continue;
    queryClient.setQueryData<ConversationsInfinite>(queryKey, (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              data: page.data.map(apply),
            })),
          }
        : current,
    );
  }

  const detail = queryClient.getQueryData<ConversationDto>(
    inboxKeys.conversation(conversationId),
  );
  if (detail) {
    queryClient.setQueryData(inboxKeys.conversation(conversationId), {
      ...detail,
      ...patch,
    });
  }

  const byContactQueries = queryClient.getQueriesData<ConversationDto[]>({
    queryKey: inboxKeys.contactConversationsAll,
  });
  for (const [queryKey, data] of byContactQueries) {
    if (!data) continue;
    queryClient.setQueryData<ConversationDto[]>(queryKey, data.map(apply));
  }
}

/**
 * Atualiza o lastMessagePreview das listas/detalhe/por-contato quando
 * `message` é a ÚLTIMA mensagem da conversa (lastMessageAt <= createdAt —
 * comparação lexicográfica de ISO strings). Usado no `message:updated`
 * (re-host de mídia), que pode mudar o preview (ex.: caption).
 */
export function patchConversationPreviewForMessage(
  queryClient: QueryClient,
  message: MessageDto,
  preview: string,
): void {
  const apply = (item: ConversationDto): ConversationDto =>
    item.id === message.conversationId &&
    item.lastMessageAt !== null &&
    item.lastMessageAt <= message.createdAt
      ? { ...item, lastMessagePreview: preview }
      : item;

  const listQueries = queryClient.getQueriesData<ConversationsInfinite>({
    queryKey: inboxKeys.conversationLists,
  });
  for (const [queryKey, data] of listQueries) {
    if (!data) continue;
    queryClient.setQueryData<ConversationsInfinite>(queryKey, (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              data: page.data.map(apply),
            })),
          }
        : current,
    );
  }

  const detail = queryClient.getQueryData<ConversationDto>(
    inboxKeys.conversation(message.conversationId),
  );
  if (detail) {
    queryClient.setQueryData(inboxKeys.conversation(message.conversationId), apply(detail));
  }

  const byContactQueries = queryClient.getQueriesData<ConversationDto[]>({
    queryKey: inboxKeys.contactConversationsAll,
  });
  for (const [queryKey, data] of byContactQueries) {
    if (!data) continue;
    queryClient.setQueryData<ConversationDto[]>(queryKey, data.map(apply));
  }
}

/** Propaga um contato atualizado para todas as conversas em cache. */
export function patchContactInCaches(
  queryClient: QueryClient,
  contact: ContactDto,
): void {
  const apply = (item: ConversationDto): ConversationDto =>
    item.contactId === contact.id ? { ...item, contact } : item;

  const listQueries = queryClient.getQueriesData<ConversationsInfinite>({
    queryKey: inboxKeys.conversationLists,
  });
  for (const [queryKey, data] of listQueries) {
    if (!data) continue;
    queryClient.setQueryData<ConversationsInfinite>(queryKey, (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              data: page.data.map(apply),
            })),
          }
        : current,
    );
  }

  const detailQueries = queryClient.getQueriesData<ConversationDto>({
    queryKey: inboxKeys.conversationDetails,
  });
  for (const [queryKey, data] of detailQueries) {
    if (!data || data.contactId !== contact.id) continue;
    queryClient.setQueryData(queryKey, { ...data, contact });
  }
}

// ---------------------------------------------------------------------------
// Mensagens — upsert com dedupe + reconciliação de otimistas
// ---------------------------------------------------------------------------

function sameContent(a: MessageDto, b: MessageDto): boolean {
  return a.type === b.type && JSON.stringify(a.content) === JSON.stringify(b.content);
}

/**
 * Insere/atualiza uma mensagem no cache da thread (dedupe por id).
 * Quando a mensagem confirmada chega (API ou socket) e existe uma otimista
 * OUTBOUND com o mesmo conteúdo, a otimista é substituída — sem duplicar.
 */
export function upsertMessageInCache(
  queryClient: QueryClient,
  message: MessageDto,
  options: { replaceOptimisticId?: string } = {},
): void {
  const key = inboxKeys.messages(message.conversationId);
  const current = queryClient.getQueryData<MessagesInfinite>(key);
  if (!current) return; // Thread nunca aberta — será buscada ao abrir.

  const exists = current.pages.some((page) =>
    page.data.some((item) => item.id === message.id),
  );

  const pages = current.pages.map((page) => ({
    ...page,
    data: page.data
      // Remove a otimista correspondente (reconciliação).
      .filter((item) => {
        if (item.id === options.replaceOptimisticId) return false;
        if (
          !exists &&
          isOptimisticId(item.id) &&
          item.direction === "OUTBOUND" &&
          message.direction === "OUTBOUND" &&
          sameContent(item, message)
        ) {
          return false;
        }
        return true;
      })
      .map((item) => (item.id === message.id ? { ...item, ...message } : item)),
  }));

  if (!exists) {
    // Páginas são "mais recentes primeiro" — novas entram no início da 1ª.
    const first = pages[0];
    if (first) {
      pages[0] = { ...first, data: [message, ...first.data] };
    } else {
      pages.push({ data: [message], nextCursor: null });
    }
  }

  queryClient.setQueryData<MessagesInfinite>(key, { ...current, pages });
}

/**
 * Patch POR ID de uma mensagem já presente no cache da thread (sem inserir —
 * diferente do upsert). Usado no `message:updated`: se a thread nunca foi
 * aberta/carregada, não há o que atualizar (a API já devolve o content novo).
 */
export function patchMessageInCache(queryClient: QueryClient, message: MessageDto): void {
  const key = inboxKeys.messages(message.conversationId);
  const current = queryClient.getQueryData<MessagesInfinite>(key);
  if (!current) return;

  queryClient.setQueryData<MessagesInfinite>(key, {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      data: page.data.map((item) =>
        item.id === message.id ? { ...item, ...message } : item,
      ),
    })),
  });
}

const STATUS_RANK: Record<MessageStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4, // FAILED sempre sobrescreve (estado terminal de erro)
};

/** Patch de status (ticks) — nunca rebaixa (ex.: READ não volta a DELIVERED). */
export function patchMessageStatusInCache(
  queryClient: QueryClient,
  payload: { messageId: string; conversationId: string; status: MessageStatus },
): void {
  const key = inboxKeys.messages(payload.conversationId);
  const current = queryClient.getQueryData<MessagesInfinite>(key);
  if (!current) return;

  queryClient.setQueryData<MessagesInfinite>(key, {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      data: page.data.map((item) => {
        if (item.id !== payload.messageId) return item;
        if (
          payload.status !== "FAILED" &&
          STATUS_RANK[payload.status] <= STATUS_RANK[item.status]
        ) {
          return item;
        }
        return { ...item, status: payload.status };
      }),
    })),
  });
}

/** Remove uma mensagem (ex.: otimista com falha ao reenviar). */
export function removeMessageFromCache(
  queryClient: QueryClient,
  conversationId: string,
  messageId: string,
): void {
  const key = inboxKeys.messages(conversationId);
  const current = queryClient.getQueryData<MessagesInfinite>(key);
  if (!current) return;
  queryClient.setQueryData<MessagesInfinite>(key, {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      data: page.data.filter((item) => item.id !== messageId),
    })),
  });
}

// ---------------------------------------------------------------------------
// Unread total (título da aba)
// ---------------------------------------------------------------------------

/** Soma o unread de conversas únicas presentes nas listas em cache. */
export function computeUnreadTotal(queryClient: QueryClient): number {
  const seen = new Map<string, number>();
  const listQueries = queryClient.getQueriesData<ConversationsInfinite>({
    queryKey: inboxKeys.conversationLists,
  });
  for (const [, data] of listQueries) {
    if (!data) continue;
    for (const page of data.pages) {
      for (const conversation of page.data) {
        seen.set(conversation.id, conversation.unreadCount);
      }
    }
  }
  let total = 0;
  for (const count of seen.values()) total += count;
  return total;
}
