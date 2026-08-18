"use client";

import { useMemo } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { toast } from "sonner";

import type { ContactDto, ConversationDto, MessageDto } from "@sm/shared";

import { ApiError } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";
import {
  addConversationTag,
  createTag,
  fetchConversationCounts,
  getConversation,
  listAgents,
  listContactConversations,
  listConversations,
  listMessages,
  listStages,
  listTags,
  markConversationRead,
  removeConversationTag,
  sendMessage,
  updateContact,
  updateConversation,
  type SendMessageInput,
  type UpdateContactInput,
  type UpdateConversationInput,
} from "./api";
import {
  patchConversationInCaches,
  patchContactInCaches,
  removeMessageFromCache,
  upsertConversationInCaches,
  upsertMessageInCache,
} from "./cache";
import { inboxKeys } from "./keys";
import {
  OPTIMISTIC_ID_PREFIX,
  type ConversationFilters,
  type MessagesPage,
} from "./types";

type MessagesInfinite = InfiniteData<MessagesPage, string | null>;

function errorMessageOf(error: unknown): string {
  return error instanceof ApiError
    ? error.friendlyMessage
    : "Algo deu errado. Tente novamente.";
}

// ---------------------------------------------------------------------------
// Conversas
// ---------------------------------------------------------------------------

export function useConversationsInfinite(filters: ConversationFilters) {
  return useInfiniteQuery({
    queryKey: inboxKeys.conversationList(filters),
    queryFn: ({ pageParam }) => listConversations(filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.data.length, 0);
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useConversationCounts(filters: ConversationFilters) {
  return useQuery({
    queryKey: inboxKeys.conversationCounts(filters),
    queryFn: () => fetchConversationCounts(filters),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: inboxKeys.conversation(id ?? "none"),
    queryFn: () => getConversation(id ?? ""),
    enabled: id !== null,
    staleTime: 10_000,
  });
}

export function useUpdateConversation(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateConversationInput) =>
      updateConversation(conversationId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: inboxKeys.conversation(conversationId),
      });
      const previous = queryClient.getQueryData<ConversationDto>(
        inboxKeys.conversation(conversationId),
      );
      patchConversationInCaches(queryClient, conversationId, input);
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        upsertConversationInCaches(queryClient, context.previous);
      }
      toast.error(errorMessageOf(error));
    },
    onSuccess: (conversation) => {
      upsertConversationInCaches(queryClient, conversation);
      void queryClient.invalidateQueries({
        queryKey: inboxKeys.conversationCountsAll,
      });
    },
  });
}

export function useMarkConversationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => markConversationRead(conversationId),
    onMutate: (conversationId) => {
      patchConversationInCaches(queryClient, conversationId, { unreadCount: 0 });
    },
  });
}

// ---------------------------------------------------------------------------
// Tags da conversa
// ---------------------------------------------------------------------------

export function useConversationTags(conversationId: string) {
  const queryClient = useQueryClient();

  const add = useMutation({
    mutationFn: (tagId: string) => addConversationTag(conversationId, tagId),
    onSuccess: (result) => {
      if (result && typeof result === "object") {
        upsertConversationInCaches(queryClient, result);
      } else {
        void queryClient.invalidateQueries({
          queryKey: inboxKeys.conversation(conversationId),
        });
      }
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });

  const remove = useMutation({
    mutationFn: (tagId: string) => removeConversationTag(conversationId, tagId),
    onMutate: (tagId) => {
      const detail = queryClient.getQueryData<ConversationDto>(
        inboxKeys.conversation(conversationId),
      );
      if (detail) {
        patchConversationInCaches(queryClient, conversationId, {
          tags: detail.tags.filter((tag) => tag.id !== tagId),
        });
      }
    },
    onSuccess: (result) => {
      if (result && typeof result === "object") {
        upsertConversationInCaches(queryClient, result);
      }
    },
    onError: (error) => {
      toast.error(errorMessageOf(error));
      void queryClient.invalidateQueries({
        queryKey: inboxKeys.conversation(conversationId),
      });
    },
  });

  return { add, remove };
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export function useMessagesInfinite(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: inboxKeys.messages(conversationId ?? "none"),
    queryFn: ({ pageParam }) => listMessages(conversationId ?? "", pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: conversationId !== null,
    staleTime: 60_000,
  });
}

/** Achata as páginas (mais recentes primeiro) em ordem cronológica, sem duplicatas. */
export function useFlatMessages(
  data: InfiniteData<MessagesPage, unknown> | undefined,
): MessageDto[] {
  return useMemo(() => {
    if (!data) return [];
    const byId = new Map<string, MessageDto>();
    for (const page of data.pages) {
      for (const message of page.data) {
        if (!byId.has(message.id)) byId.set(message.id, message);
      }
    }
    return [...byId.values()].sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }, [data]);
}

let optimisticSequence = 0;

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);

  return useMutation({
    mutationFn: (input: SendMessageInput) => sendMessage(conversationId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: inboxKeys.messages(conversationId),
      });
      optimisticSequence += 1;
      const optimisticId = `${OPTIMISTIC_ID_PREFIX}${Date.now()}-${optimisticSequence}`;
      const optimistic: MessageDto = {
        id: optimisticId,
        conversationId,
        direction: "OUTBOUND",
        type: input.type,
        content: input.content,
        status: "PENDING",
        authorId: user?.id ?? null,
        author: user ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl } : null,
        isAiGenerated: false,
        errorMessage: null,
        createdAt: new Date().toISOString(),
      };
      upsertMessageInCache(queryClient, optimistic);
      return { optimisticId };
    },
    onSuccess: (message, _input, context) => {
      upsertMessageInCache(queryClient, message, {
        replaceOptimisticId: context.optimisticId,
      });
    },
    onError: (error, _input, context) => {
      if (context) {
        // Mantém a bolha com status FAILED para permitir "Reenviar".
        const key = inboxKeys.messages(conversationId);
        const current = queryClient.getQueryData<MessagesInfinite>(key);
        if (current) {
          queryClient.setQueryData<MessagesInfinite>(key, {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              data: page.data.map((item) =>
                item.id === context.optimisticId
                  ? { ...item, status: "FAILED", errorMessage: errorMessageOf(error) }
                  : item,
              ),
            })),
          });
        }
      }
      toast.error(errorMessageOf(error));
    },
  });
}

/** Remove a bolha FAILED e devolve o conteúdo para reenvio. */
export function useDiscardFailedMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return (messageId: string): void => {
    removeMessageFromCache(queryClient, conversationId, messageId);
  };
}

// ---------------------------------------------------------------------------
// Recursos auxiliares
// ---------------------------------------------------------------------------

export function useAgents() {
  return useQuery({
    queryKey: inboxKeys.agents,
    queryFn: listAgents,
    staleTime: 5 * 60_000,
  });
}

export function useStages() {
  return useQuery({
    queryKey: inboxKeys.stages,
    queryFn: listStages,
    staleTime: 5 * 60_000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: inboxKeys.tags,
    queryFn: listTags,
    staleTime: 5 * 60_000,
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: string }) => createTag(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.tags });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

export function useContactConversations(contactId: string | null) {
  return useQuery({
    queryKey: inboxKeys.contactConversations(contactId ?? "none"),
    queryFn: () => listContactConversations(contactId ?? ""),
    enabled: contactId !== null,
    staleTime: 30_000,
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateContactInput }) =>
      updateContact(id, input),
    onSuccess: (contact: ContactDto) => {
      patchContactInCaches(queryClient, contact);
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}
