"use client";

import { useId } from "react";

import type { ChannelType } from "@sm/shared";

import { cn } from "@/lib/utils";

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  WEBCHAT: "Webchat",
};

interface ChannelIconProps {
  type: ChannelType;
  className?: string;
}

/** WhatsApp — glifo oficial simplificado em verde #25D366. */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="#25D366"
      aria-hidden
      className={cn("h-4 w-4", className)}
    >
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.74 1.21h.01c5.45 0 9.89-4.44 9.89-9.9 0-2.64-1.03-5.13-2.9-7A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.39c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.24 8.24Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

/** Instagram — glifo com gradiente oficial (id único por instância via useId). */
function InstagramIcon({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("h-4 w-4", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FED576" />
          <stop offset="26%" stopColor="#F47133" />
          <stop offset="61%" stopColor="#BC3081" />
          <stop offset="100%" stopColor="#4C63D2" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.35 1.06.4 2.23.06 1.27.08 1.65.08 4.85s-.02 3.58-.08 4.85c-.05 1.17-.24 1.8-.4 2.23a3.7 3.7 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.06.35-2.23.4-1.27.06-1.65.08-4.85.08s-3.58-.02-4.85-.08c-1.17-.05-1.8-.24-2.23-.4a3.72 3.72 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07ZM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.88 5.88 0 0 0-2.13 1.38A5.88 5.88 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.8.72 1.47 1.38 2.13a5.88 5.88 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56 1.28.06 1.69.07 4.95.07s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.88 5.88 0 0 0 2.13-1.38 5.88 5.88 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.88 5.88 0 0 0-1.38-2.13A5.88 5.88 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 12 18.16 6.16 6.16 0 0 0 12 5.84ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm7.85-10.4a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0Z"
      />
    </svg>
  );
}

/** Webchat — balão de chat azul. */
function WebchatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="#3B82F6"
      aria-hidden
      className={cn("h-4 w-4", className)}
    >
      <path d="M12 2C6.48 2 2 5.94 2 10.8c0 2.5 1.19 4.75 3.1 6.35-.14 1.32-.63 2.63-1.55 3.72a.5.5 0 0 0 .43.83c2.09-.14 3.9-.94 5.27-1.94.88.22 1.8.34 2.75.34 5.52 0 10-3.94 10-8.8S17.52 2 12 2Zm-4.5 9.9a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Zm4.5 0a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Zm4.5 0a1.35 1.35 0 1 1 0-2.7 1.35 1.35 0 0 1 0 2.7Z" />
    </svg>
  );
}

/** Ícone do canal (SVG inline) — WhatsApp verde, Instagram gradiente, Webchat azul. */
export function ChannelIcon({ type, className }: ChannelIconProps) {
  switch (type) {
    case "WHATSAPP":
      return <WhatsAppIcon className={className} />;
    case "INSTAGRAM":
      return <InstagramIcon className={className} />;
    case "WEBCHAT":
      return <WebchatIcon className={className} />;
    default:
      return null;
  }
}

/** Ícone do canal com anel de fundo — badge sobre o avatar do contato. */
export function ChannelBadge({ type, className }: ChannelIconProps) {
  return (
    <span
      className={cn(
        "flex h-[18px] w-[18px] items-center justify-center rounded-full bg-card ring-2 ring-card",
        className,
      )}
      title={CHANNEL_LABELS[type]}
    >
      <ChannelIcon type={type} className="h-3 w-3" />
    </span>
  );
}
