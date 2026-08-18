"use client";

import { memo } from "react";
import { Sparkles } from "lucide-react";

import type { ConversationDto } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { formatRelativeShort } from "@/lib/inbox/utils";
import { useInboxStore } from "@/lib/stores/inbox";
import { cn } from "@/lib/utils";

import { ChannelBadge } from "./channel-icons";

interface ConversationItemProps {
  conversation: ConversationDto;
  active: boolean;
  onSelect: (id: string) => void;
}

function ConversationItemInner({ conversation, active, onSelect }: ConversationItemProps) {
  const typing = useInboxStore(
    (state) => state.typingByConversation[conversation.id],
  );
  const contactTyping = typing?.isTyping === true && typing.contactId !== undefined;

  const hasUnread = conversation.unreadCount > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group relative flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-muted/60",
      )}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-primary"
        />
      ) : null}

      <div className="relative shrink-0">
        <UserAvatar
          name={conversation.contact.name}
          src={conversation.contact.avatarUrl}
          className="h-10 w-10"
        />
        <ChannelBadge
          type={conversation.channelType}
          className="absolute -bottom-1 -right-1"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              hasUnread ? "font-semibold" : "font-medium",
            )}
          >
            {conversation.contact.name}
          </p>
          <span
            className={cn(
              "shrink-0 text-[11px] tabular-nums",
              hasUnread ? "font-medium text-primary" : "text-muted-foreground",
            )}
          >
            {conversation.lastMessageAt
              ? formatRelativeShort(conversation.lastMessageAt)
              : formatRelativeShort(conversation.createdAt)}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-1.5">
          {contactTyping ? (
            <p className="min-w-0 flex-1 truncate text-[13px] font-medium italic text-primary">
              digitando…
            </p>
          ) : (
            <p
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                hasUnread ? "text-foreground/90" : "text-muted-foreground",
              )}
            >
              {conversation.lastMessagePreview ?? "Conversa iniciada"}
            </p>
          )}

          <span className="flex shrink-0 items-center gap-1">
            {conversation.aiEnabled ? (
              <Sparkles
                className="h-3.5 w-3.5 text-primary/80"
                aria-label="IA ativa"
              />
            ) : null}
            {conversation.assignee ? (
              <UserAvatar
                name={conversation.assignee.name}
                src={conversation.assignee.avatarUrl}
                className="h-4 w-4 text-[7px]"
                title={`Responsável: ${conversation.assignee.name}`}
              />
            ) : null}
            {hasUnread ? (
              <span
                className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                aria-label={`${conversation.unreadCount} mensagens não lidas`}
              >
                {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </button>
  );
}

export const ConversationItem = memo(ConversationItemInner);
