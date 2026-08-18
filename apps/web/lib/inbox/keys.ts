import type { ConversationFilters } from "./types";

/**
 * Forma normalizada dos filtros usada na query key — ordem estável de campos
 * e tagIds ordenadas, para que filtros equivalentes compartilhem cache.
 */
export interface NormalizedFilters {
  status: ConversationFilters["status"];
  q: string;
  channelType: ConversationFilters["channelType"];
  assigneeId: string | null;
  stageId: string | null;
  tagIds: string[];
}

export function normalizeFilters(filters: ConversationFilters): NormalizedFilters {
  return {
    status: filters.status,
    q: filters.q.trim(),
    channelType: filters.channelType,
    assigneeId: filters.assigneeId,
    stageId: filters.stageId,
    tagIds: [...filters.tagIds].sort(),
  };
}

/** Query keys centralizadas da inbox (React Query). */
export const inboxKeys = {
  conversations: ["conversations"] as const,
  conversationLists: ["conversations", "list"] as const,
  conversationList: (filters: ConversationFilters) =>
    ["conversations", "list", normalizeFilters(filters)] as const,
  conversationCounts: (filters: ConversationFilters) => {
    const { status: _status, ...rest } = normalizeFilters(filters);
    return ["conversations", "counts", rest] as const;
  },
  conversationCountsAll: ["conversations", "counts"] as const,
  conversationDetails: ["conversations", "detail"] as const,
  conversation: (id: string) => ["conversations", "detail", id] as const,
  contactConversations: (contactId: string) =>
    ["conversations", "by-contact", contactId] as const,
  contactConversationsAll: ["conversations", "by-contact"] as const,
  messages: (conversationId: string) => ["messages", conversationId] as const,
  agents: ["users", "agents"] as const,
  stages: ["stages"] as const,
  tags: ["tags"] as const,
};
