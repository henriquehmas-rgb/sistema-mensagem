"use client";

import { useCallback, useEffect, useState } from "react";

import { useConversation } from "@/lib/inbox/hooks";
import { DEFAULT_FILTERS, type ConversationFilters } from "@/lib/inbox/types";
import { useInboxStore } from "@/lib/stores/inbox";

import { ConversationList } from "./conversation-list";
import { CrmPanel } from "./crm-panel";
import { Thread } from "./thread";

/**
 * Inbox unificada — 3 painéis: lista (340px) | thread (flex) | CRM (320px,
 * colapsável). Estado da conversa ativa vive no store (o realtime usa para
 * suprimir toast/som e auto-marcar como lida).
 */
export function InboxClient() {
  const [filters, setFilters] = useState<ConversationFilters>(DEFAULT_FILTERS);

  const activeConversationId = useInboxStore((state) => state.activeConversationId);
  const setActiveConversation = useInboxStore((state) => state.setActiveConversation);
  const crmOpen = useInboxStore((state) => state.crmOpen);

  // Ao sair da inbox, a conversa deixa de estar "aberta" para o realtime.
  useEffect(
    () => () => {
      useInboxStore.getState().setActiveConversation(null);
    },
    [],
  );

  const handleFiltersChange = useCallback(
    (patch: Partial<ConversationFilters>): void => {
      setFilters((current) => ({ ...current, ...patch }));
    },
    [],
  );

  const handleSelect = useCallback(
    (id: string): void => {
      setActiveConversation(id);
    },
    [setActiveConversation],
  );

  const activeConversationQuery = useConversation(activeConversationId);
  const activeConversation = activeConversationQuery.data ?? null;

  return (
    <div className="flex h-dvh min-w-0 flex-1 overflow-hidden">
      <ConversationList
        filters={filters}
        onFiltersChange={handleFiltersChange}
        activeId={activeConversationId}
        onSelect={handleSelect}
      />

      <Thread conversationId={activeConversationId} />

      {crmOpen && activeConversation ? (
        <CrmPanel
          conversation={activeConversation}
          onSelectConversation={handleSelect}
        />
      ) : null}
    </div>
  );
}
