"use client";

import { useEffect } from "react";
import { MessageSquareDashed } from "lucide-react";

import { QueryError } from "@/components/query-error";
import { useConversation, useMarkConversationRead } from "@/lib/inbox/hooks";
import { getSocket } from "@/lib/socket";

import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { ThreadHeader } from "./thread-header";

interface ThreadProps {
  conversationId: string | null;
}

function ThreadPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <MessageSquareDashed className="h-8 w-8 text-muted-foreground/70" />
      </div>
      <div>
        <p className="text-sm font-medium">Selecione uma conversa</p>
        <p className="mt-1 max-w-64 text-xs text-muted-foreground">
          Escolha uma conversa na lista ao lado para ver as mensagens e responder.
        </p>
      </div>
    </div>
  );
}

export function Thread({ conversationId }: ThreadProps) {
  const conversationQuery = useConversation(conversationId);
  const markRead = useMarkConversationRead();

  // Entra/sai do room da conversa (recebe eventos direcionados).
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    socket.emit("conversation:join", { conversationId });
    return () => {
      socket.emit("conversation:leave", { conversationId });
    };
  }, [conversationId]);

  // Marca como lida ao abrir / quando chegam novas mensagens com a thread aberta.
  const unreadCount = conversationQuery.data?.unreadCount ?? 0;
  const { mutate: mutateMarkRead } = markRead;
  useEffect(() => {
    if (conversationId && unreadCount > 0) {
      mutateMarkRead(conversationId);
    }
  }, [conversationId, unreadCount, mutateMarkRead]);

  if (!conversationId) {
    return (
      <section aria-label="Conversa" className="flex h-full min-w-0 flex-1 flex-col">
        <ThreadPlaceholder />
      </section>
    );
  }

  const conversation = conversationQuery.data;

  return (
    <section aria-label="Conversa" className="flex h-full min-w-0 flex-1 flex-col">
      {conversation ? (
        <>
          <ThreadHeader conversation={conversation} />
          <MessageList conversation={conversation} />
          <Composer conversation={conversation} />
        </>
      ) : conversationQuery.isError ? (
        <div className="flex h-full items-center justify-center">
          <QueryError
            error={conversationQuery.error}
            retrying={conversationQuery.isFetching}
            onRetry={() => void conversationQuery.refetch()}
          />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-2 w-2 animate-ping rounded-full bg-primary/60" />
            Carregando conversa…
          </div>
        </div>
      )}
    </section>
  );
}
