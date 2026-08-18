"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, Loader2 } from "lucide-react";

import type { ConversationDto, MessageDto } from "@sm/shared";

import { QueryError } from "@/components/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDiscardFailedMessage,
  useFlatMessages,
  useMessagesInfinite,
  useSendMessage,
} from "@/lib/inbox/hooks";
import { isOptimisticId } from "@/lib/inbox/types";
import { formatDayDivider } from "@/lib/inbox/utils";
import { useInboxStore } from "@/lib/stores/inbox";
import { cn } from "@/lib/utils";

import { ImageLightbox } from "./image-lightbox";
import { MessageBubble } from "./message-bubble";
import { TypingIndicator } from "./typing-indicator";

const NEAR_BOTTOM_PX = 96;

interface DayGroup {
  key: string;
  label: string;
  messages: MessageDto[];
}

function groupByDay(messages: MessageDto[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const message of messages) {
    const key = message.createdAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.messages.push(message);
    } else {
      groups.push({ key, label: formatDayDivider(message.createdAt), messages: [message] });
    }
  }
  return groups;
}

function ThreadSkeleton() {
  return (
    <div aria-hidden className="space-y-4 px-4 py-6">
      {[52, 40, 64, 36, 56].map((width, index) => (
        <div
          key={index}
          className={cn("flex", index % 2 === 0 ? "justify-start" : "justify-end")}
        >
          <Skeleton
            className="h-12 rounded-2xl"
            style={{ width: `${width}%` }}
          />
        </div>
      ))}
    </div>
  );
}

interface MessageListProps {
  conversation: ConversationDto;
}

export function MessageList({ conversation }: MessageListProps) {
  const conversationId = conversation.id;
  const query = useMessagesInfinite(conversationId);
  const messages = useFlatMessages(query.data);
  const sendMessage = useSendMessage(conversationId);
  const discardFailed = useDiscardFailedMessage(conversationId);

  const typing = useInboxStore((state) => state.typingByConversation[conversationId]);
  const contactTyping = typing?.isTyping === true && typing.contactId !== undefined;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Preservação de posição ao carregar mensagens antigas no topo.
  const pendingScrollAdjustRef = useRef<number | null>(null);
  const pagesCount = query.data?.pages.length ?? 0;

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto"): void => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    nearBottomRef.current = true;
    setShowJumpButton(false);
  }, []);

  // Início: sempre abre no fim da thread.
  const firstLoadDoneRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (query.isLoading || messages.length === 0) return;
    if (firstLoadDoneRef.current !== conversationId) {
      firstLoadDoneRef.current = conversationId;
      scrollToBottom();
    }
  }, [conversationId, query.isLoading, messages.length, scrollToBottom]);

  // Ajuste de scroll após prepend de mensagens antigas.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const previousHeight = pendingScrollAdjustRef.current;
    if (container && previousHeight !== null) {
      container.scrollTop += container.scrollHeight - previousHeight;
      pendingScrollAdjustRef.current = null;
    }
  }, [pagesCount]);

  // Nova mensagem: acompanha se estiver no fim; senão mostra o botão flutuante.
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!lastMessageId) return;
    if (firstLoadDoneRef.current !== conversationId) return;
    const isOwnOutbound =
      lastMessage?.direction === "OUTBOUND" &&
      (isOptimisticId(lastMessageId) || lastMessage.authorId !== null);
    if (nearBottomRef.current || isOwnOutbound) {
      scrollToBottom("smooth");
    } else {
      setShowJumpButton(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage só à última mensagem
  }, [lastMessageId]);

  // Digitando: rola junto quando já está no fim.
  useEffect(() => {
    if (contactTyping && nearBottomRef.current) scrollToBottom("smooth");
  }, [contactTyping, scrollToBottom]);

  const handleScroll = (): void => {
    const container = containerRef.current;
    if (!container) return;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    nearBottomRef.current = distance < NEAR_BOTTOM_PX;
    if (nearBottomRef.current) setShowJumpButton(false);
  };

  // Carregar antigas ao chegar no topo (sentinela).
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = containerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          hasNextPage &&
          !isFetchingNextPage &&
          firstLoadDoneRef.current === conversationId
        ) {
          pendingScrollAdjustRef.current = container.scrollHeight;
          void fetchNextPage();
        }
      },
      { root: container, rootMargin: "120px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, conversationId, messages.length]);

  const handleResend = useCallback(
    (message: MessageDto): void => {
      if (isOptimisticId(message.id)) {
        // Otimista que nunca chegou à API: descarta e reenvia como nova.
        discardFailed(message.id);
        sendMessage.mutate({ type: message.type, content: message.content });
        return;
      }
      // FAILED persistida no servidor (id real): reenvia como nova mensagem e,
      // se o reenvio confirmar, remove a bolha antiga para não duplicar.
      sendMessage.mutate(
        { type: message.type, content: message.content },
        { onSuccess: () => discardFailed(message.id) },
      );
    },
    [discardFailed, sendMessage],
  );

  const groups = useMemo(() => groupByDay(messages), [messages]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-4"
        role="log"
        aria-label="Mensagens da conversa"
      >
        <div ref={topSentinelRef} aria-hidden className="h-px" />

        {isFetchingNextPage ? (
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Carregando mensagens antigas…
          </div>
        ) : null}

        {query.isLoading ? (
          <ThreadSkeleton />
        ) : query.isError && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <QueryError
              error={query.error}
              retrying={query.isFetching}
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Nenhuma mensagem ainda — envie a primeira abaixo.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <div key={group.key} className="space-y-2">
                <div className="sticky top-0 z-10 flex justify-center py-1">
                  <span className="rounded-full border bg-card px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-soft">
                    {group.label}
                  </span>
                </div>
                {group.messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onOpenImage={setLightboxSrc}
                    onResend={handleResend}
                  />
                ))}
              </div>
            ))}
            {contactTyping ? <TypingIndicator name={conversation.contact.name} /> : null}
          </div>
        )}
      </div>

      {showJumpButton ? (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 animate-fade-up items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-primary shadow-soft-lg transition-colors hover:bg-accent"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Novas mensagens
        </button>
      ) : null}

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
