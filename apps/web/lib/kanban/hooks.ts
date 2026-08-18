"use client";

import { useEffect, useMemo } from "react";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

import type { ConversationDto, PaginatedDto } from "@sm/shared";

import { ApiError } from "@/lib/api";
import { useConversationsInfinite } from "@/lib/inbox/hooks";
import { inboxKeys } from "@/lib/inbox/keys";
import { patchConversationInCaches } from "@/lib/inbox/cache";
import type { ConversationFilters } from "@/lib/inbox/types";

import { moveConversation, type MoveConversationInput } from "./api";

/** Máximo de páginas pré-carregadas no board (25/página → 250 conversas). */
const MAX_BOARD_PAGES = 10;

/**
 * Conversas do board — reusa o cache/infinite query da inbox (mesma query key,
 * então o realtime `conversation:moved`/`updated` atualiza o board de graça) e
 * pré-carrega todas as páginas até o limite.
 */
export function useKanbanConversations(filters: ConversationFilters) {
  const query = useConversationsInfinite(filters);

  const { hasNextPage, isFetchingNextPage, fetchNextPage, data } = query;
  const loadedPages = data?.pages.length ?? 0;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && loadedPages < MAX_BOARD_PAGES) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, loadedPages, fetchNextPage]);

  const conversations = useMemo<ConversationDto[]>(() => {
    const byId = new Map<string, ConversationDto>();
    for (const page of data?.pages ?? []) {
      for (const conversation of page.data) {
        if (!byId.has(conversation.id)) byId.set(conversation.id, conversation);
      }
    }
    return [...byId.values()];
  }, [data]);

  return { ...query, conversations };
}

type ConversationsInfinite = InfiniteData<PaginatedDto<ConversationDto>, number>;

/** Lê uma conversa de qualquer lista em cache (para snapshot de rollback). */
function findConversationInCaches(
  queryClient: QueryClient,
  conversationId: string,
): ConversationDto | undefined {
  const detail = queryClient.getQueryData<ConversationDto>(
    inboxKeys.conversation(conversationId),
  );
  if (detail) return detail;

  const listQueries = queryClient.getQueriesData<ConversationsInfinite>({
    queryKey: inboxKeys.conversationLists,
  });
  for (const [, data] of listQueries) {
    for (const page of data?.pages ?? []) {
      const found = page.data.find((item) => item.id === conversationId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Move otimista no kanban: aplica `stageId`/`stagePosition` em todos os caches
 * antes do POST /conversations/:id/move; reverte com toast em caso de erro.
 */
export function useMoveConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MoveConversationInput) => moveConversation(input),
    onMutate: (input) => {
      const previous = findConversationInCaches(queryClient, input.conversationId);
      patchConversationInCaches(queryClient, input.conversationId, {
        stageId: input.stageId,
        stagePosition: input.stagePosition,
      });
      return {
        previous: previous
          ? { stageId: previous.stageId, stagePosition: previous.stagePosition }
          : null,
      };
    },
    onError: (error, input, context) => {
      if (context?.previous) {
        patchConversationInCaches(queryClient, input.conversationId, context.previous);
      }
      toast.error(
        error instanceof ApiError
          ? error.friendlyMessage
          : "Não foi possível mover a conversa. Tente novamente.",
      );
    },
    onSuccess: (result, input) => {
      // API pode devolver a conversa atualizada — sincroniza o cache.
      if (result && typeof result === "object") {
        patchConversationInCaches(queryClient, input.conversationId, result);
      }
    },
  });
}
