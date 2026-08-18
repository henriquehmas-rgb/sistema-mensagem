import {
  differenceInCalendarDays,
  differenceInMinutes,
  differenceInSeconds,
  format,
  isToday,
  isYesterday,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import type { MessageContent, MessageDto } from "@sm/shared";

// ---------------------------------------------------------------------------
// Datas (pt-BR)
// ---------------------------------------------------------------------------

const WEEKDAYS_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/** Tempo relativo curto pt-BR: "agora", "5m", "2h", "seg", "12/08/25". */
export function formatRelativeShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();

  if (differenceInSeconds(now, date) < 60) return "agora";
  if (differenceInMinutes(now, date) < 60) {
    return `${differenceInMinutes(now, date)}m`;
  }
  if (isToday(date)) {
    return `${Math.floor(differenceInMinutes(now, date) / 60)}h`;
  }
  const days = differenceInCalendarDays(now, date);
  if (days < 7) return WEEKDAYS_SHORT[date.getDay()] ?? "";
  return format(date, "dd/MM/yy");
}

/** Divisor de dia da thread: "Hoje", "Ontem", "quarta-feira, 13 de agosto". */
export function formatDayDivider(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (isToday(date)) return "Hoje";
  if (isYesterday(date)) return "Ontem";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return format(date, sameYear ? "EEEE, d 'de' MMMM" : "d 'de' MMMM 'de' yyyy", {
    locale: ptBR,
  });
}

/** Hora da mensagem no rodapé da bolha: "14:32". */
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "HH:mm");
}

/** Data completa pt-BR: "12 de ago. de 2026, 14:32". */
export function formatFullDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "d 'de' MMM 'de' yyyy, HH:mm", { locale: ptBR });
}

/** Duração de áudio: "1:05". */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Type guards do content (união MessageContent — @sm/shared)
// ---------------------------------------------------------------------------

export type TextContent = Extract<MessageContent, { text: string }>;
export type MediaContent = Extract<MessageContent, { mediaUrl: string }>;
export type TemplateContent = Extract<MessageContent, { templateName: string }>;
export type LocationContent = Extract<MessageContent, { latitude: number }>;

export function isTextContent(content: MessageContent): content is TextContent {
  return typeof (content as TextContent).text === "string";
}

export function isMediaContent(content: MessageContent): content is MediaContent {
  return typeof (content as MediaContent).mediaUrl === "string";
}

export function isTemplateContent(
  content: MessageContent,
): content is TemplateContent {
  return typeof (content as TemplateContent).templateName === "string";
}

export function isLocationContent(
  content: MessageContent,
): content is LocationContent {
  return typeof (content as LocationContent).latitude === "number";
}

// ---------------------------------------------------------------------------
// Preview / rótulos
// ---------------------------------------------------------------------------

/** Preview de 1 linha para lista e toasts, por tipo de mensagem. */
export function getMessagePreview(message: Pick<MessageDto, "type" | "content">): string {
  const { content } = message;
  switch (message.type) {
    case "TEXT":
      return isTextContent(content) ? content.text : "";
    case "IMAGE":
      return isMediaContent(content) && content.caption
        ? `📷 ${content.caption}`
        : "📷 Imagem";
    case "AUDIO":
      return "🎙️ Áudio";
    case "VIDEO":
      return isMediaContent(content) && content.caption
        ? `🎬 ${content.caption}`
        : "🎬 Vídeo";
    case "DOCUMENT":
      return isMediaContent(content) && content.filename
        ? `📄 ${content.filename}`
        : "📄 Documento";
    case "STICKER":
      return "💟 Figurinha";
    case "LOCATION":
      return "📍 Localização";
    case "TEMPLATE":
      return isTemplateContent(content) ? `Modelo: ${content.templateName}` : "Modelo";
    case "SYSTEM":
      return isTextContent(content) ? content.text : "Mensagem do sistema";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// URLs / mime
// ---------------------------------------------------------------------------

/** Regex de URL com grupo de captura — usável com String.split para linkify. */
export const URL_SPLIT_REGEX = /(https?:\/\/[^\s<>"']+[^\s<>"'.,:;!?)\]])/g;

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  rar: "application/vnd.rar",
};

/** Infere o mime type pela extensão da URL (MVP de anexo por URL). */
export function guessMimeType(url: string, fallback = "application/octet-stream"): string {
  try {
    const pathname = new URL(url).pathname;
    const extension = pathname.split(".").pop()?.toLowerCase() ?? "";
    return EXTENSION_MIME[extension] ?? fallback;
  } catch {
    return fallback;
  }
}

/** Extrai o nome do arquivo da URL (fallback para cards de documento). */
export function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const name = decodeURIComponent(pathname.split("/").pop() ?? "");
    return name.length > 0 ? name : "arquivo";
  } catch {
    return "arquivo";
  }
}
