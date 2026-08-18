"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Loader2, Search, X } from "lucide-react";

import type { ConversationDto } from "@sm/shared";

import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAgents,
  useConversationCounts,
  useConversationsInfinite,
  useStages,
  useTags,
} from "@/lib/inbox/hooks";
import { isSoundMuted, setSoundMuted } from "@/lib/inbox/sound";
import {
  UNASSIGNED,
  type ConversationFilters,
  type StatusTab,
} from "@/lib/inbox/types";
import { cn } from "@/lib/utils";

import { CHANNEL_LABELS } from "./channel-icons";
import { ConversationItem } from "./conversation-item";
import { FiltersPopover, countActiveFilters } from "./filters-popover";

const SEARCH_DEBOUNCE_MS = 300;

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "OPEN", label: "Abertas" },
  { value: "PENDING", label: "Pendentes" },
  { value: "RESOLVED", label: "Resolvidas" },
  { value: "ALL", label: "Todas" },
];

interface ConversationListProps {
  filters: ConversationFilters;
  onFiltersChange: (patch: Partial<ConversationFilters>) => void;
  activeId: string | null;
  onSelect: (id: string) => void;
}

function ListSkeleton() {
  return (
    <div aria-hidden className="space-y-0.5 py-1">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-start gap-3 px-3 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 pt-0.5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyIllustration() {
  return (
    <svg viewBox="0 0 160 120" aria-hidden className="h-28 w-36 text-muted-foreground/40">
      <rect
        x="18"
        y="22"
        width="86"
        height="52"
        rx="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <circle cx="44" cy="48" r="4" fill="currentColor" />
      <circle cx="61" cy="48" r="4" fill="currentColor" />
      <circle cx="78" cy="48" r="4" fill="currentColor" />
      <path d="M36 74v14l16-14" fill="none" stroke="currentColor" strokeWidth="3" />
      <rect
        x="76"
        y="58"
        width="66"
        height="40"
        rx="10"
        fill="hsl(var(--background))"
        stroke="currentColor"
        strokeWidth="3"
      />
      <line
        x1="90"
        y1="72"
        x2="128"
        y2="72"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <line
        x1="90"
        y1="82"
        x2="118"
        y2="82"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M124 98v10l-12-10" fill="none" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function ConversationList({
  filters,
  onFiltersChange,
  activeId,
  onSelect,
}: ConversationListProps) {
  const [searchInput, setSearchInput] = useState(filters.q);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    setMuted(isSoundMuted());
  }, []);

  // Busca com debounce → filtro `q`.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput.trim() !== filters.q.trim()) {
        onFiltersChange({ q: searchInput });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput, filters.q, onFiltersChange]);

  const listQuery = useConversationsInfinite(filters);
  const countsQuery = useConversationCounts(filters);
  const agentsQuery = useAgents();
  const stagesQuery = useStages();
  const tagsQuery = useTags();

  const agents = agentsQuery.data ?? [];
  const stages = stagesQuery.data ?? [];
  const tags = tagsQuery.data ?? [];

  const conversations = useMemo<ConversationDto[]>(() => {
    const pages = listQuery.data?.pages ?? [];
    const byId = new Map<string, ConversationDto>();
    for (const page of pages) {
      for (const conversation of page.data) {
        if (!byId.has(conversation.id)) byId.set(conversation.id, conversation);
      }
    }
    return [...byId.values()];
  }, [listQuery.data]);

  // Infinite scroll — sentinela no fim da lista.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = listQuery;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, conversations.length]);

  const counts = countsQuery.data;
  const countFor = (tab: StatusTab): number | undefined => {
    if (!counts) return undefined;
    switch (tab) {
      case "OPEN":
        return counts.open;
      case "PENDING":
        return counts.pending;
      case "RESOLVED":
        return counts.resolved;
      case "ALL":
        return counts.all;
    }
  };

  // Chips de filtros ativos (removíveis).
  const chips = useMemo<FilterChip[]>(() => {
    const result: FilterChip[] = [];
    if (filters.channelType) {
      result.push({
        key: "channel",
        label: CHANNEL_LABELS[filters.channelType],
        onRemove: () => onFiltersChange({ channelType: null }),
      });
    }
    if (filters.assigneeId) {
      const label =
        filters.assigneeId === UNASSIGNED
          ? "Não atribuídas"
          : (agents.find((agent) => agent.id === filters.assigneeId)?.name ??
            "Responsável");
      result.push({
        key: "assignee",
        label,
        onRemove: () => onFiltersChange({ assigneeId: null }),
      });
    }
    if (filters.stageId) {
      result.push({
        key: "stage",
        label:
          stages.find((stage) => stage.id === filters.stageId)?.name ?? "Etapa",
        onRemove: () => onFiltersChange({ stageId: null }),
      });
    }
    for (const tagId of filters.tagIds) {
      result.push({
        key: `tag-${tagId}`,
        label: tags.find((tag) => tag.id === tagId)?.name ?? "Tag",
        onRemove: () =>
          onFiltersChange({ tagIds: filters.tagIds.filter((id) => id !== tagId) }),
      });
    }
    return result;
  }, [filters, agents, stages, tags, onFiltersChange]);

  const hasActiveFilters =
    countActiveFilters(filters) > 0 || filters.q.trim().length > 0;
  const isInitialLoading = listQuery.isLoading;
  const isEmpty = !isInitialLoading && conversations.length === 0;

  const toggleMute = (): void => {
    setMuted((value) => {
      const next = !value;
      setSoundMuted(next);
      return next;
    });
  };

  return (
    <section
      aria-label="Lista de conversas"
      className="flex h-full w-[340px] shrink-0 flex-col border-r bg-card/50"
    >
      {/* Header: título + som + busca + filtros */}
      <div className="shrink-0 space-y-2.5 border-b px-3 pb-2.5 pt-3">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold tracking-tight">Inbox</h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={toggleMute}
                aria-label={
                  muted ? "Ativar som de notificação" : "Silenciar notificações"
                }
              >
                {muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {muted ? "Som de notificação desativado" : "Som de notificação ativo"}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar conversas…"
              className="h-9 pl-8 pr-8"
              aria-label="Buscar conversas"
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
            onChange={onFiltersChange}
            agents={agents}
            stages={stages}
            tags={tags}
          />
        </div>

        <Tabs
          value={filters.status}
          onValueChange={(value) => onFiltersChange({ status: value as StatusTab })}
        >
          <TabsList className="grid h-8 w-full grid-cols-4 p-0.5">
            {STATUS_TABS.map((tab) => {
              const count = countFor(tab.value);
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="h-full gap-1 px-1 text-[11px]"
                >
                  <span className="truncate">{tab.label}</span>
                  {count !== undefined && count > 0 ? (
                    <span
                      className={cn(
                        "rounded-full px-1 text-[10px] font-semibold tabular-nums",
                        filters.status === tab.value
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground",
                      )}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-[11px] font-medium text-primary"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={`Remover filtro ${chip.label}`}
                  className="rounded-full p-0.5 hover:bg-primary/15"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Lista com infinite scroll */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isInitialLoading ? (
          <ListSkeleton />
        ) : listQuery.isError && conversations.length === 0 ? (
          <QueryError
            error={listQuery.error}
            retrying={listQuery.isFetching}
            onRetry={() => void listQuery.refetch()}
            className="h-full"
          />
        ) : isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <EmptyIllustration />
            <div>
              <p className="text-sm font-medium">Nenhuma conversa encontrada</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasActiveFilters
                  ? "Tente ajustar a busca ou os filtros ativos."
                  : "As novas conversas dos seus canais aparecem aqui."}
              </p>
            </div>
            {hasActiveFilters ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchInput("");
                  onFiltersChange({
                    q: "",
                    channelType: null,
                    assigneeId: null,
                    stageId: null,
                    tagIds: [],
                  });
                }}
              >
                Limpar filtros
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {conversations.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                active={conversation.id === activeId}
                onSelect={onSelect}
              />
            ))}
            <div ref={sentinelRef} aria-hidden className="h-px" />
            {isFetchingNextPage ? (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando mais…
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
