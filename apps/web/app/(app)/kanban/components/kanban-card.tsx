"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Sparkles } from "lucide-react";

import type { ConversationDto } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { formatRelativeShort } from "@/lib/inbox/utils";
import { cn } from "@/lib/utils";

import { ChannelIcon } from "../../inbox/components/channel-icons";

const MAX_VISIBLE_TAGS = 3;

interface KanbanCardContentProps {
  conversation: ConversationDto;
  /** Aparência do DragOverlay: leve rotação + sombra forte. */
  overlay?: boolean;
}

/** Corpo visual do card — compartilhado entre o sortable e o DragOverlay. */
export function KanbanCardContent({ conversation, overlay }: KanbanCardContentProps) {
  const visibleTags = conversation.tags.slice(0, MAX_VISIBLE_TAGS);
  const overflowCount = conversation.tags.length - visibleTags.length;

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border bg-card p-3 text-left shadow-soft transition-shadow",
        overlay
          ? "rotate-2 cursor-grabbing shadow-soft-xl ring-1 ring-primary/25"
          : "hover:shadow-soft-lg",
      )}
    >
      <div className="flex items-center gap-2">
        <UserAvatar
          name={conversation.contact.name}
          src={conversation.contact.avatarUrl}
          className="h-7 w-7 text-[10px]"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {conversation.contact.name}
        </span>
        <ChannelIcon type={conversation.channelType} className="h-3.5 w-3.5 shrink-0" />
      </div>

      <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
        {conversation.lastMessagePreview ?? "Conversa iniciada"}
      </p>

      {visibleTags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {visibleTags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex max-w-24 items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${tag.color}1f`, color: tag.color }}
              title={tag.name}
            >
              <span
                className="h-1 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              <span className="truncate">{tag.name}</span>
            </span>
          ))}
          {overflowCount > 0 ? (
            <span
              className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              title={conversation.tags
                .slice(MAX_VISIBLE_TAGS)
                .map((tag) => tag.name)
                .join(", ")}
            >
              +{overflowCount}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          {conversation.assignee ? (
            <UserAvatar
              name={conversation.assignee.name}
              src={conversation.assignee.avatarUrl}
              className="h-5 w-5 text-[8px]"
              title={`Responsável: ${conversation.assignee.name}`}
            />
          ) : (
            <span className="text-[10px] text-muted-foreground">Não atribuída</span>
          )}
          {conversation.aiEnabled ? (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary"
              title="IA ativa nesta conversa"
            >
              <Sparkles className="h-2.5 w-2.5" />
              IA
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {formatRelativeShort(conversation.lastMessageAt ?? conversation.createdAt)}
        </span>
      </div>
    </div>
  );
}

interface KanbanCardProps {
  conversation: ConversationDto;
  onOpen: (id: string) => void;
}

function KanbanCardInner({ conversation, onOpen }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: conversation.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("animate-fade-up list-none", isDragging && "opacity-40")}
    >
      <button
        type="button"
        onClick={() => onOpen(conversation.id)}
        className="w-full cursor-grab touch-none text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing"
        aria-label={`Abrir conversa de ${conversation.contact.name}`}
        {...attributes}
        {...listeners}
      >
        <KanbanCardContent conversation={conversation} />
      </button>
    </li>
  );
}

export const KanbanCard = memo(KanbanCardInner);
