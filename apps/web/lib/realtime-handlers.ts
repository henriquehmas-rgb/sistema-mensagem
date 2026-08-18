"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { ContactDto, ConversationDto, MessageDto, MessageStatus } from "@sm/shared";

import { markConversationRead } from "@/lib/inbox/api";
import {
  computeUnreadTotal,
  patchContactInCaches,
  patchConversationInCaches,
  patchMessageStatusInCache,
  upsertConversationInCaches,
  upsertMessageInCache,
} from "@/lib/inbox/cache";
import { inboxKeys } from "@/lib/inbox/keys";
import { playNotificationSound } from "@/lib/inbox/sound";
import { getMessagePreview } from "@/lib/inbox/utils";
import { getSocket } from "@/lib/socket";
import { useInboxStore } from "@/lib/stores/inbox";
import { APP_NAME } from "@/lib/constants";

const TYPING_EXPIRY_MS = 8_000;

/**
 * Janela de coalescência da invalidação de counts: cada refresh dispara 4
 * GET /conversations; sem isso, rajadas de eventos (message:new etc.) viram
 * rajadas de 4 requests por evento e estouram o throttler da API (429).
 */
const COUNTS_INVALIDATE_WINDOW_MS = 2_500;

function invalidateCounts(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: inboxKeys.conversationCountsAll });
}

function updateInboxTitle(queryClient: QueryClient, onInbox: boolean): void {
  if (typeof document === "undefined" || !onInbox) return;
  const unread = computeUnreadTotal(queryClient);
  const title = unread > 0 ? `(${unread}) Inbox — ${APP_NAME}` : `Inbox — ${APP_NAME}`;
  if (document.title !== title) document.title = title;
}

/**
 * Handlers de tempo real (Socket.io /rt) — montado UMA vez no layout do app.
 * Atualiza os caches do React Query, o estado de "digitando…", toca som/toast
 * para mensagens de conversas não abertas e mantém o título "(N) Inbox".
 */
export function useRealtimeHandlers(enabled: boolean): void {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const onInbox = pathname.startsWith("/inbox");
  const onInboxRef = useRef(onInbox);
  onInboxRef.current = onInbox;

  // Registro dos listeners do socket.
  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // Throttle trailing: no máximo 1 invalidação de counts por janela.
    let countsTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleCountsInvalidation = (): void => {
      if (countsTimer) return;
      countsTimer = setTimeout(() => {
        countsTimer = null;
        invalidateCounts(queryClient);
      }, COUNTS_INVALIDATE_WINDOW_MS);
    };

    const onMessageNew = (payload: {
      message: MessageDto;
      conversation: ConversationDto;
    }): void => {
      const { message, conversation } = payload;
      const { activeConversationId, clearTyping } = useInboxStore.getState();
      const isActive =
        activeConversationId === conversation.id && onInboxRef.current;

      upsertMessageInCache(queryClient, message);
      clearTyping(conversation.id);

      if (isActive && message.direction === "INBOUND") {
        // Conversa aberta: zera unread local e informa a API (fire-and-forget).
        upsertConversationInCaches(queryClient, { ...conversation, unreadCount: 0 });
        void markConversationRead(conversation.id).catch(() => undefined);
      } else {
        upsertConversationInCaches(queryClient, conversation);
        if (message.direction === "INBOUND") {
          playNotificationSound();
          toast(conversation.contact.name, {
            description: getMessagePreview(message),
            action: {
              label: "Abrir",
              onClick: () => {
                useInboxStore.getState().setActiveConversation(conversation.id);
                router.push("/inbox");
              },
            },
          });
        }
      }
      scheduleCountsInvalidation();
      updateInboxTitle(queryClient, onInboxRef.current);
    };

    const onMessageStatus = (payload: {
      messageId: string;
      conversationId: string;
      status: MessageStatus;
    }): void => {
      patchMessageStatusInCache(queryClient, payload);
    };

    const onConversationNew = (payload: { conversation: ConversationDto }): void => {
      upsertConversationInCaches(queryClient, payload.conversation);
      scheduleCountsInvalidation();
      updateInboxTitle(queryClient, onInboxRef.current);
    };

    const onConversationUpdated = (payload: {
      conversation: ConversationDto;
    }): void => {
      upsertConversationInCaches(queryClient, payload.conversation);
      scheduleCountsInvalidation();
      updateInboxTitle(queryClient, onInboxRef.current);
    };

    const onConversationMoved = (payload: {
      conversationId: string;
      stageId: string;
      stagePosition: number;
      movedBy: string | null;
    }): void => {
      patchConversationInCaches(queryClient, payload.conversationId, {
        stageId: payload.stageId,
        stagePosition: payload.stagePosition,
      });
    };

    const onTyping = (payload: {
      conversationId: string;
      userId?: string;
      contactId?: string;
      isTyping: boolean;
    }): void => {
      const store = useInboxStore.getState();
      const existing = typingTimers.get(payload.conversationId);
      if (existing) clearTimeout(existing);

      if (payload.isTyping) {
        const typing: { isTyping: true; contactId?: string; userId?: string } = {
          isTyping: true,
        };
        if (payload.contactId !== undefined) typing.contactId = payload.contactId;
        if (payload.userId !== undefined) typing.userId = payload.userId;
        store.setTyping(payload.conversationId, typing);
        // Salvaguarda: expira sozinho caso o "isTyping: false" se perca.
        typingTimers.set(
          payload.conversationId,
          setTimeout(() => {
            useInboxStore.getState().clearTyping(payload.conversationId);
            typingTimers.delete(payload.conversationId);
          }, TYPING_EXPIRY_MS),
        );
      } else {
        store.clearTyping(payload.conversationId);
        typingTimers.delete(payload.conversationId);
      }
    };

    const onContactUpdated = (payload: { contact: ContactDto }): void => {
      patchContactInCaches(queryClient, payload.contact);
    };

    socket.on("message:new", onMessageNew);
    socket.on("message:status", onMessageStatus);
    socket.on("conversation:new", onConversationNew);
    socket.on("conversation:updated", onConversationUpdated);
    socket.on("conversation:moved", onConversationMoved);
    socket.on("typing", onTyping);
    socket.on("contact:updated", onContactUpdated);

    return () => {
      socket.off("message:new", onMessageNew);
      socket.off("message:status", onMessageStatus);
      socket.off("conversation:new", onConversationNew);
      socket.off("conversation:updated", onConversationUpdated);
      socket.off("conversation:moved", onConversationMoved);
      socket.off("typing", onTyping);
      socket.off("contact:updated", onContactUpdated);
      for (const timer of typingTimers.values()) clearTimeout(timer);
      typingTimers.clear();
      if (countsTimer) {
        clearTimeout(countsTimer);
        countsTimer = null;
      }
    };
  }, [enabled, queryClient, router]);

  // Título da aba "(N) Inbox — SEEG Omni" — recalculado a cada mudança de cache.
  useEffect(() => {
    if (!enabled || !onInbox) return;
    updateInboxTitle(queryClient, true);
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      updateInboxTitle(queryClient, onInboxRef.current);
    });
    return unsubscribe;
  }, [enabled, onInbox, queryClient]);
}
