"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { HandHelping, MoreHorizontal, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { KanbanColumnData } from "@/lib/kanban/utils";
import { columnDroppableId } from "@/lib/kanban/utils";
import { cn } from "@/lib/utils";

import { KanbanCard } from "./kanban-card";

interface KanbanColumnProps {
  column: KanbanColumnData;
  onOpenConversation: (id: string) => void;
}

function KanbanColumnInner({ column, onOpenConversation }: KanbanColumnProps) {
  const router = useRouter();
  const { stage, conversations } = column;
  const isHandoff = stage.isHumanHandoff;

  const { setNodeRef, isOver } = useDroppable({ id: columnDroppableId(stage.id) });

  return (
    <section
      aria-label={`Etapa ${stage.name}`}
      className={cn(
        "flex h-full w-[300px] shrink-0 flex-col rounded-xl border bg-muted/40",
        isHandoff && "border-warning/60 bg-warning/[0.06]",
        isOver && "ring-2 ring-primary/40",
      )}
    >
      {/* Header da coluna */}
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
        {isHandoff ? (
          <HandHelping className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        ) : (
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: stage.color }}
          />
        )}
        <h2
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-semibold",
            isHandoff && "text-warning",
          )}
        >
          {stage.name}
        </h2>
        <span
          className={cn(
            "rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground",
            isHandoff && "bg-warning/15 text-warning",
          )}
        >
          {conversations.length}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground"
              aria-label={`Opções da etapa ${stage.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => router.push("/settings?tab=stages")}>
              <Pencil />
              Editar etapa
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {isHandoff ? (
        <p className="px-3 pb-2 text-[10px] font-medium uppercase tracking-wider text-warning/80">
          Intervenção humana
        </p>
      ) : null}

      {/* Cards (droppable + sortable) */}
      <SortableContext
        items={conversations.map((conversation) => conversation.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul
          ref={setNodeRef}
          className="min-h-16 flex-1 space-y-2 overflow-y-auto px-2 pb-2"
        >
          {conversations.map((conversation) => (
            <KanbanCard
              key={conversation.id}
              conversation={conversation}
              onOpen={onOpenConversation}
            />
          ))}
          {conversations.length === 0 ? (
            <li className="flex h-24 list-none items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
              Solte conversas aqui
            </li>
          ) : null}
        </ul>
      </SortableContext>
    </section>
  );
}

export const KanbanColumn = memo(KanbanColumnInner);
