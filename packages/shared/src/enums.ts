// Enums espelhados do schema Prisma — manter em sincronia com docs/CONTRACTS.md §3

export const Roles = ["ADMIN", "SUPERVISOR", "AGENT"] as const;
export type Role = (typeof Roles)[number];

export const ChannelTypes = ["WHATSAPP", "INSTAGRAM", "WEBCHAT"] as const;
export type ChannelType = (typeof ChannelTypes)[number];

export const ChannelStatuses = ["ACTIVE", "DISABLED", "ERROR"] as const;
export type ChannelStatus = (typeof ChannelStatuses)[number];

export const ConversationStatuses = ["OPEN", "PENDING", "RESOLVED", "SNOOZED"] as const;
export type ConversationStatus = (typeof ConversationStatuses)[number];

export const MessageDirections = ["INBOUND", "OUTBOUND"] as const;
export type MessageDirection = (typeof MessageDirections)[number];

export const MessageTypes = [
  "TEXT",
  "IMAGE",
  "AUDIO",
  "VIDEO",
  "DOCUMENT",
  "STICKER",
  "LOCATION",
  "TEMPLATE",
  "SYSTEM",
] as const;
export type MessageType = (typeof MessageTypes)[number];

export const MessageStatuses = ["PENDING", "SENT", "DELIVERED", "READ", "FAILED"] as const;
export type MessageStatus = (typeof MessageStatuses)[number];

export const SourceTypes = ["PDF", "URL", "TEXT", "TABLE"] as const;
export type SourceType = (typeof SourceTypes)[number];

export const IngestStatuses = ["PENDING", "PROCESSING", "READY", "FAILED"] as const;
export type IngestStatus = (typeof IngestStatuses)[number];

export const RunStatuses = ["SUCCESS", "FAILED", "SKIPPED"] as const;
export type RunStatus = (typeof RunStatuses)[number];
