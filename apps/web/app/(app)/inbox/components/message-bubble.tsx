"use client";

import { memo, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Download,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  MapPin,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import type { MessageDto, MessageStatus } from "@sm/shared";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  URL_SPLIT_REGEX,
  filenameFromUrl,
  formatMessageTime,
  isLocationContent,
  isMediaContent,
  isTemplateContent,
  isTextContent,
} from "@/lib/inbox/utils";
import { cn } from "@/lib/utils";

import { AudioPlayer } from "./audio-player";

// ---------------------------------------------------------------------------
// Texto com URLs clicáveis
// ---------------------------------------------------------------------------

function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_SPLIT_REGEX);
  return (
    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 opacity-90 hover:opacity-100"
          >
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Ticks de status (rodapé das OUTBOUND)
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<MessageStatus, string> = {
  PENDING: "Enviando…",
  SENT: "Enviada",
  DELIVERED: "Entregue",
  READ: "Lida",
  FAILED: "Falha no envio",
};

function StatusTicks({ status }: { status: MessageStatus }) {
  let icon: ReactNode;
  switch (status) {
    case "PENDING":
      icon = <Clock className="h-3 w-3 opacity-70" />;
      break;
    case "SENT":
      icon = <Check className="h-3.5 w-3.5 opacity-80" />;
      break;
    case "DELIVERED":
      icon = <CheckCheck className="h-3.5 w-3.5 opacity-80" />;
      break;
    case "READ":
      icon = <CheckCheck className="h-3.5 w-3.5 text-status-read" />;
      break;
    case "FAILED":
      icon = <AlertCircle className="h-3.5 w-3.5 text-status-failed" />;
      break;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span aria-label={STATUS_LABELS[status]}>{icon}</span>
      </TooltipTrigger>
      <TooltipContent side="left">{STATUS_LABELS[status]}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Cards por tipo de conteúdo
// ---------------------------------------------------------------------------

function mimeIcon(mimeType: string): LucideIcon {
  if (mimeType.startsWith("image/")) return FileImage;
  if (mimeType.startsWith("audio/")) return FileAudio;
  if (mimeType.startsWith("video/")) return FileVideo;
  if (mimeType.includes("pdf") || mimeType.includes("word") || mimeType.startsWith("text/")) {
    return FileText;
  }
  if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType.includes("csv")) {
    return FileSpreadsheet;
  }
  if (mimeType.includes("zip") || mimeType.includes("rar") || mimeType.includes("compressed")) {
    return FileArchive;
  }
  return File;
}

function DocumentCard({
  mediaUrl,
  mimeType,
  filename,
}: {
  mediaUrl: string;
  mimeType: string;
  filename?: string;
}) {
  const Icon = mimeIcon(mimeType);
  const name = filename ?? filenameFromUrl(mediaUrl);
  return (
    <div
      className="flex w-60 max-w-full items-center gap-2.5 rounded-lg p-2"
      style={{ backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)" }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: "color-mix(in srgb, currentColor 12%, transparent)" }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{name}</p>
        <p className="text-[10px] uppercase tracking-wide opacity-70">
          {mimeType.split("/").pop() ?? mimeType}
        </p>
      </div>
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        download={name}
        aria-label={`Baixar ${name}`}
        className="shrink-0 rounded-md p-1.5 transition-opacity hover:opacity-70"
      >
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}

function LocationCard({
  latitude,
  longitude,
  name,
  address,
}: {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}) {
  const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-60 max-w-full items-start gap-2.5 rounded-lg p-2.5 transition-opacity hover:opacity-85"
      style={{ backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)" }}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: "color-mix(in srgb, currentColor 12%, transparent)" }}
      >
        <MapPin className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {name ?? "Localização compartilhada"}
        </span>
        {address ? (
          <span className="mt-0.5 block truncate text-[11px] opacity-80">{address}</span>
        ) : null}
        <span className="mt-0.5 block text-[10px] tabular-nums opacity-70">
          {latitude.toFixed(6)}, {longitude.toFixed(6)} · abrir no Maps ↗
        </span>
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Corpo da mensagem por tipo
// ---------------------------------------------------------------------------

function MessageBody({
  message,
  onOpenImage,
}: {
  message: MessageDto;
  onOpenImage: (src: string) => void;
}) {
  const { content } = message;

  switch (message.type) {
    case "TEXT":
      return isTextContent(content) ? (
        <p className="text-sm leading-relaxed">
          <LinkifiedText text={content.text} />
        </p>
      ) : null;

    case "IMAGE":
    case "STICKER": {
      if (!isMediaContent(content)) return null;
      const isSticker = message.type === "STICKER";
      return (
        <figure className="space-y-1">
          <div className={cn("grid gap-1", isSticker ? "w-28" : "w-56 max-w-full")}>
            <button
              type="button"
              onClick={() => onOpenImage(content.mediaUrl)}
              className="overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label="Abrir imagem"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- mídia externa dos canais */}
              <img
                src={content.mediaUrl}
                alt={content.caption ?? "Imagem"}
                loading="lazy"
                className={cn(
                  "w-full cursor-zoom-in object-cover transition-transform duration-200 hover:scale-[1.02]",
                  isSticker ? "h-28 object-contain" : "max-h-64",
                )}
              />
            </button>
          </div>
          {content.caption ? (
            <figcaption className="text-sm leading-relaxed">
              <LinkifiedText text={content.caption} />
            </figcaption>
          ) : null}
        </figure>
      );
    }

    case "AUDIO":
      return isMediaContent(content) ? (
        <AudioPlayer
          src={content.mediaUrl}
          {...(content.durationSeconds !== undefined
            ? { durationSeconds: content.durationSeconds }
            : {})}
        />
      ) : null;

    case "VIDEO":
      return isMediaContent(content) ? (
        <figure className="space-y-1">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- mídia dos canais */}
          <video
            src={content.mediaUrl}
            controls
            preload="metadata"
            className="max-h-72 w-64 max-w-full rounded-lg bg-black/80 object-contain"
          />
          {content.caption ? (
            <figcaption className="text-sm leading-relaxed">
              <LinkifiedText text={content.caption} />
            </figcaption>
          ) : null}
        </figure>
      ) : null;

    case "DOCUMENT":
      return isMediaContent(content) ? (
        <DocumentCard
          mediaUrl={content.mediaUrl}
          mimeType={content.mimeType}
          {...(content.filename !== undefined ? { filename: content.filename } : {})}
        />
      ) : null;

    case "LOCATION":
      return isLocationContent(content) ? (
        <LocationCard
          latitude={content.latitude}
          longitude={content.longitude}
          {...(content.name !== undefined ? { name: content.name } : {})}
          {...(content.address !== undefined ? { address: content.address } : {})}
        />
      ) : null;

    case "TEMPLATE":
      return isTemplateContent(content) ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="px-1.5 py-0 text-[10px] uppercase tracking-wide text-current"
              style={{ borderColor: "color-mix(in srgb, currentColor 40%, transparent)" }}
            >
              Modelo
            </Badge>
            <span className="text-xs font-medium">{content.templateName}</span>
          </div>
          {content.params && content.params.length > 0 ? (
            <p className="text-xs opacity-80">{content.params.join(" · ")}</p>
          ) : null}
        </div>
      ) : null;

    default:
      return isTextContent(content) ? (
        <p className="text-sm leading-relaxed">
          <LinkifiedText text={content.text} />
        </p>
      ) : null;
  }
}

// ---------------------------------------------------------------------------
// Bolha
// ---------------------------------------------------------------------------

export interface MessageBubbleProps {
  message: MessageDto;
  onOpenImage: (src: string) => void;
  onResend: (message: MessageDto) => void;
}

function MessageBubbleInner({ message, onOpenImage, onResend }: MessageBubbleProps) {
  // SYSTEM — centralizado, sutil.
  if (message.type === "SYSTEM") {
    return (
      <div className="flex justify-center py-1">
        <span className="max-w-[80%] rounded-full bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
          {isTextContent(message.content) ? message.content.text : "Evento do sistema"}
          <span className="ml-1.5 tabular-nums opacity-70">
            {formatMessageTime(message.createdAt)}
          </span>
        </span>
      </div>
    );
  }

  const isOutbound = message.direction === "OUTBOUND";
  const isAi = isOutbound && message.isAiGenerated;
  const failed = message.status === "FAILED";

  return (
    <div
      className={cn(
        "flex w-full animate-fade-up",
        isOutbound ? "justify-end" : "justify-start",
      )}
    >
      <div className={cn("flex max-w-[78%] flex-col gap-1", isOutbound && "items-end")}>
        <div
          className={cn(
            "relative rounded-2xl px-3 py-2 shadow-soft",
            isOutbound
              ? "rounded-br-md bg-primary text-primary-foreground"
              : "rounded-bl-md bg-muted text-foreground",
            isAi && "ring-1 ring-inset ring-primary-foreground/35",
            failed && "opacity-90",
          )}
        >
          {isAi ? (
            <div className="mb-1 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              <span className="rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider">
                IA
              </span>
            </div>
          ) : null}

          <MessageBody message={message} onOpenImage={onOpenImage} />

          <div
            className={cn(
              "mt-1 flex items-center gap-1 text-[10px] tabular-nums",
              isOutbound ? "justify-end opacity-80" : "text-muted-foreground",
            )}
          >
            {!isOutbound && message.author?.name ? (
              <span className="mr-1 font-medium">{message.author.name}</span>
            ) : null}
            <span>{formatMessageTime(message.createdAt)}</span>
            {isOutbound ? <StatusTicks status={message.status} /> : null}
          </div>
        </div>

        {failed ? (
          <div className="flex items-center gap-2 text-[11px] text-destructive">
            <span>{message.errorMessage ?? "Não foi possível enviar."}</span>
            <button
              type="button"
              onClick={() => onResend(message)}
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:opacity-80"
            >
              <RefreshCw className="h-3 w-3" />
              Reenviar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleInner);
