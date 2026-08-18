"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, ImageIcon, Lock, SendHorizonal, X } from "lucide-react";

import type { ConversationDto, MessageContent } from "@sm/shared";

import { Button } from "@/components/ui/button";
import { useSendMessage, useUpdateConversation } from "@/lib/inbox/hooks";
import { useChannels } from "@/lib/settings/hooks";
import { getSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";

import { AttachmentPopover, type StagedAttachment } from "./attachment-popover";
import { EmojiPicker } from "./emoji-picker";

const TYPING_IDLE_MS = 2_000;
const MAX_TEXTAREA_HEIGHT_PX = 160;

interface ComposerProps {
  conversation: ConversationDto;
}

const CHANNEL_ISSUE_LABELS = {
  DISABLED: "desativado",
  ERROR: "com erro",
} as const;

export function Composer({ conversation }: ComposerProps) {
  const conversationId = conversation.id;
  const disabled = conversation.status === "RESOLVED";

  // Canal da conversa fora do ar (DISABLED/ERROR) → banner + envio bloqueado.
  // Fail-open: sem dados do canal (query em erro/carregando), não bloqueia.
  const channelsQuery = useChannels();
  const channel = channelsQuery.data?.find(
    (item) => item.id === conversation.channelId,
  );
  const channelIssue =
    channel !== undefined && channel.status !== "ACTIVE"
      ? CHANNEL_ISSUE_LABELS[channel.status]
      : null;

  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<StagedAttachment | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const sendMessage = useSendMessage(conversationId);
  const updateConversation = useUpdateConversation(conversationId);

  // Limpa rascunho ao trocar de conversa.
  useEffect(() => {
    setText("");
    setAttachment(null);
  }, [conversationId]);

  // Auto-grow do textarea.
  const resizeTextarea = useCallback((): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [text, resizeTextarea]);

  // Typing com debounce: emite true na primeira tecla, false após 2s parado.
  const typingActiveRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback((): void => {
    if (typingTimerRef.current) {
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      getSocket().emit("typing", { conversationId, isTyping: false });
    }
  }, [conversationId]);

  const notifyTyping = useCallback((): void => {
    if (!typingActiveRef.current) {
      typingActiveRef.current = true;
      getSocket().emit("typing", { conversationId, isTyping: true });
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }, [conversationId, stopTyping]);

  useEffect(() => stopTyping, [stopTyping]);

  const canSend =
    !disabled &&
    channelIssue === null &&
    !sendMessage.isPending &&
    (text.trim().length > 0 || attachment !== null);

  const handleSend = (): void => {
    if (!canSend) return;
    const trimmed = text.trim();

    if (attachment) {
      const content: MessageContent = {
        mediaUrl: attachment.mediaUrl,
        mimeType: attachment.mimeType,
        ...(trimmed.length > 0 ? { caption: trimmed } : {}),
        ...(attachment.filename !== undefined ? { filename: attachment.filename } : {}),
      };
      sendMessage.mutate({ type: attachment.kind, content });
    } else {
      sendMessage.mutate({ type: "TEXT", content: { text: trimmed } });
    }

    setText("");
    setAttachment(null);
    stopTyping();
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const insertEmoji = (emoji: string): void => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setText((value) => value + emoji);
      return;
    }
    const start = textarea.selectionStart ?? text.length;
    const end = textarea.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + emoji.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  if (disabled) {
    return (
      <div className="shrink-0 border-t bg-card/60 px-4 py-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Conversa resolvida — reabra para enviar novas mensagens.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={updateConversation.isPending}
            onClick={() => updateConversation.mutate({ status: "OPEN" })}
          >
            Reabrir conversa
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t bg-card/60 px-4 py-3">
      {channelIssue !== null && channel !== undefined ? (
        <div
          role="alert"
          className="mb-2 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-xs text-foreground/80">
            O canal <span className="font-medium">{channel.name}</span> está{" "}
            {channelIssue} — não é possível enviar mensagens por ele agora.
            {channel.status === "ERROR"
              ? " Verifique a conexão em Configurações → Canais."
              : ""}
          </p>
        </div>
      ) : null}

      {attachment ? (
        <div className="mb-2 flex items-center gap-2.5 rounded-lg border bg-muted/40 p-2">
          {attachment.kind === "IMAGE" ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview de URL externa
            <img
              src={attachment.mediaUrl}
              alt="Anexo"
              className="h-12 w-12 shrink-0 rounded-md object-cover"
            />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
              <FileText className="h-5 w-5 text-muted-foreground" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-xs font-medium">
              {attachment.kind === "IMAGE" ? (
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              {attachment.filename ?? attachment.mediaUrl}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {attachment.mimeType} · será enviado com a mensagem
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={() => setAttachment(null)}
            aria-label="Remover anexo"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      <div className="flex items-end gap-1.5 rounded-xl border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/30">
        <div className="flex items-center">
          <AttachmentPopover onStage={setAttachment} />
          <EmojiPicker onPick={insertEmoji} />
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            notifyTyping();
          }}
          onKeyDown={handleKeyDown}
          onBlur={stopTyping}
          rows={1}
          placeholder={
            attachment ? "Adicionar legenda (opcional)…" : "Escreva uma mensagem…"
          }
          aria-label="Escrever mensagem"
          className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1.5 py-2 text-sm leading-snug outline-none placeholder:text-muted-foreground"
        />

        <Button
          type="button"
          size="icon"
          className={cn("h-9 w-9 shrink-0 rounded-lg", !canSend && "opacity-60")}
          disabled={!canSend}
          onClick={handleSend}
          aria-label="Enviar mensagem"
        >
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>

      <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
        Enter envia · Shift+Enter quebra linha
      </p>
    </div>
  );
}
