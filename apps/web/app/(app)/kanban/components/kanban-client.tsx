"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, X } from "lucide-react";

import { QueryError } from "@/components/query-error";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgents, useStages, useTags } from "@/lib/inbox/hooks";
import { DEFAULT_FILTERS, type ConversationFilters } from "@/lib/inbox/types";
import { useKanbanConversations } from "@/lib/kanban/hooks";

import { FiltersPopover } from "../../inbox/components/filters-popover";
import { ConversationSheet } from "./conversation-sheet";
import { KanbanBoard } from "./kanban-board";

const SEARCH_DEBOUNCE_MS = 300;

/** Kanban mostra todas as conversas (as colunas são as etapas do pipeline). */
const KANBAN_DEFAULT_FILTERS: ConversationFilters = {
  ...DEFAULT_FILTERS,
  status: "ALL",
};

function BoardSkeleton() {
  return (
    <div aria-hidden className="flex min-h-0 flex-1 gap-3 overflow-hidden px-4 pb-4">
      {Array.from({ length: 4 }).map((_, columnIndex) => (
        <div
          key={columnIndex}
          className="flex h-full w-[300px] shrink-0 flex-col gap-2 rounded-xl border bg-muted/40 p-3"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-2.5 w-2.5 rounded-full" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="ml-auto h-4 w-6 rounded-full" />
          </div>
          {Array.from({ length: 3 }).map((_, cardIndex) => (
            <Skeleton key={cardIndex} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function KanbanClient() {
  const [filters, setFilters] = useState<ConversationFilters>(KANBAN_DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);

  const handleFiltersChange = useCallback(
    (patch: Partial<ConversationFilters>): void => {
      setFilters((current) => ({ ...current, ...patch }));
    },
    [],
  );

  // Busca com debounce → filtro `q`.
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((current) =>
        current.q.trim() === searchInput.trim()
          ? current
          : { ...current, q: searchInput },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const stagesQuery = useStages();
  const agentsQuery = useAgents();
  const tagsQuery = useTags();
  const boardQuery = useKanbanConversations(filters);
  const { conversations, isLoading } = boardQuery;

  const stages = stagesQuery.data ?? [];
  const showSkeleton = isLoading || stagesQuery.isLoading;
  const showError =
    (stagesQuery.isError && stages.length === 0) ||
    (boardQuery.isError && conversations.length === 0);

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col">
      {/* Topo: título + filtros (reuso da inbox) */}
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <h1 className="text-base font-semibold tracking-tight">Kanban</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar conversas…"
              aria-label="Buscar conversas"
              className="h-9 pl-8 pr-8"
            />
            {searchInput.length > 0 ? (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <FiltersPopover
            filters={filters}
            onChange={handleFiltersChange}
            agents={agentsQuery.data ?? []}
            stages={stages}
            tags={tagsQuery.data ?? []}
            showStageFilter={false}
          />
        </div>
      </header>

      {/* Board */}
      <div className="flex min-h-0 flex-1 flex-col pt-4">
        {showSkeleton ? (
          <BoardSkeleton />
        ) : showError ? (
          <QueryError
            error={stagesQuery.isError ? stagesQuery.error : boardQuery.error}
            retrying={stagesQuery.isFetching || boardQuery.isFetching}
            onRetry={() => {
              void stagesQuery.refetch();
              void boardQuery.refetch();
            }}
            className="flex-1"
          />
        ) : stages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-sm font-medium">Nenhuma etapa configurada</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Crie as etapas do pipeline em Configurações → Etapas para começar a
              organizar as conversas no kanban.
            </p>
          </div>
        ) : (
          <KanbanBoard
            conversations={conversations}
            stages={stages}
            onOpenConversation={setOpenConversationId}
          />
        )}
      </div>

      <ConversationSheet
        conversationId={openConversationId}
        onClose={() => setOpenConversationId(null)}
      />
    </div>
  );
}
