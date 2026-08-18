"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, SendHorizonal } from "lucide-react";

import type { MessageDto } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useConversation,
  useFlatMessages,
  useMessagesInfinite,
  useSendMessage,
} from "@/lib/inbox/hooks";
import { getSocket } from "@/lib/socket";
import { useInboxStore } from "@/lib/stores/inbox";

import {
  CHANNEL_LABELS,
  ChannelIcon,
} from "../../inbox/components/channel-icons";
import { MessageBubble } from "../../inbox/components/message-bubble";

interface ConversationSheetProps {
  conversationId: string | null;
  onClose: () => void;
}

function MiniComposer({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState("");
  const sendMessage = useSendMessage(conversationId);

  useEffect(() => {
    setText("");
  }, [conversationId]);

  const canSend = text.trim().length > 0 && !sendMessage.isPending;

  const handleSend = (): void => {
    if (!canSend) return;
    sendMessage.mutate({ type: "TEXT", content: { text: text.trim() } });
    setText("");
  };

  return (
    <div className="flex items-end gap-2 border-t pt-3">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSend();
          }
        }}
        placeholder="Responder…"
        aria-label="Responder à conversa"
        className="max-h-28 min-h-10 flex-1 resize-none text-sm"
        rows={1}
      />
      <Button
        size="icon"
        className="h-10 w-10 shrink-0"
        disabled={!canSend}
        onClick={handleSend}
        aria-label="Enviar mensagem"
      >
        {sendMessage.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <SendHorizonal className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

/** Sheet lateral do kanban — mini-thread (últimas mensagens) + composer simples. */
export function ConversationSheet({ conversationId, onClose }: ConversationSheetProps) {
  const router = useRouter();
  const conversationQuery = useConversation(conversationId);
  const messagesQuery = useMessagesInfinite(conversationId);
  const messages = useFlatMessages(messagesQuery.data);

  const conversation = conversationQuery.data ?? null;

  // Entra/sai do room da conversa (recebe eventos direcionados no realtime).
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    socket.emit("conversation:join", { conversationId });
    return () => {
      socket.emit("conversation:leave", { conversationId });
    };
  }, [conversationId]);

  // Sempre rola para a última mensagem (mini-thread mostra o fim da conversa).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, conversationId]);

  const openInInbox = (): void => {
    if (!conversationId) return;
    useInboxStore.getState().setActiveConversation(conversationId);
    router.push("/inbox");
  };

  const noopResend = (_message: MessageDto): void => undefined;
  const openImage = (src: string): void => {
    window.open(src, "_blank", "noopener,noreferrer");
  };

  return (
    <Sheet open={conversationId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="shrink-0 space-y-1 border-b px-5 py-4 pr-12 text-left">
          {conversation ? (
            <>
              <div className="flex items-center gap-3">
                <UserAvatar
                  name={conversation.contact.name}
                  src={conversation.contact.avatarUrl}
                  className="h-10 w-10"
                />
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-base">
                    {conversation.contact.name}
                  </SheetTitle>
                  <SheetDescription className="flex items-center gap-1.5 text-xs">
                    <ChannelIcon
                      type={conversation.channelType}
                      className="h-3.5 w-3.5"
                    />
                    {CHANNEL_LABELS[conversation.channelType]}
                    {conversation.assignee
                      ? ` · ${conversation.assignee.name}`
                      : " · Não atribuída"}
                  </SheetDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-fit gap-1.5"
                onClick={openInInbox}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir na Inbox
              </Button>
            </>
          ) : (
            <>
              <SheetTitle className="sr-only">Carregando conversa</SheetTitle>
              <SheetDescription className="sr-only">
                Carregando dados da conversa…
              </SheetDescription>
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </>
          )}
        </SheetHeader>

        {/* Mini-thread */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {messagesQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className={index % 2 === 0 ? "flex justify-start" : "flex justify-end"}
                >
                  <Skeleton className="h-12 w-52 rounded-2xl" />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma mensagem nesta conversa ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onOpenImage={openImage}
                  onResend={noopResend}
                />
              ))}
            </div>
          )}
        </div>

        {/* Composer simples */}
        {conversationId ? (
          <div className="shrink-0 px-4 pb-4">
            <MiniComposer conversationId={conversationId} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
