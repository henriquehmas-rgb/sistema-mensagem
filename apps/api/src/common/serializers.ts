import type {
  ChannelType,
  Contact,
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  PipelineStage,
  Prisma,
  Role,
  Tag,
  User,
} from '@prisma/client';

/**
 * Formas serializadas (JSON) dos recursos trafegados na API REST e no Socket.io.
 * Espelham packages/shared/src/models.ts — a api NÃO importa @sm/shared
 * (CONTRACTS §10); qualquer mudança aqui exige atualização coordenada lá.
 * Datas SEMPRE como ISO string.
 */

export interface UserSummaryDto {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface UserDto {
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
  isActive: boolean;
}

export interface ContactDto {
  id: string;
  orgId: string;
  name: string;
  phone: string | null;
  email: string | null;
  avatarUrl: string | null;
  notes: string | null;
  customFields: Record<string, unknown>;
  /** Memória de longo prazo por contato (CONTRACTS §15) — resumo cumulativo gerado pela IA. */
  memorySummary: string | null;
  memoryUpdatedAt: string | null;
  createdAt: string;
}

export interface TagDto {
  id: string;
  name: string;
  color: string;
}

export interface PipelineStageDto {
  id: string;
  name: string;
  color: string;
  position: number;
  isHumanHandoff: boolean;
  isDefault: boolean;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: Record<string, unknown>;
  status: MessageStatus;
  authorId: string | null;
  author?: UserSummaryDto | null;
  isAiGenerated: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  orgId: string;
  contactId: string;
  contact: ContactDto;
  channelId: string;
  channelType: ChannelType;
  status: ConversationStatus;
  assigneeId: string | null;
  assignee?: UserSummaryDto | null;
  stageId: string | null;
  stagePosition: number;
  aiEnabled: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  tags: TagDto[];
  createdAt: string;
}

export interface PaginatedDto<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ====================== Includes/selects padrão ======================

export const userSummarySelect = {
  id: true,
  name: true,
  avatarUrl: true,
} as const satisfies Prisma.UserSelect;

/** Include padrão de Conversation — cobre tudo que ConversationDto precisa. */
export const conversationInclude = {
  contact: true,
  assignee: { select: userSummarySelect },
  channel: { select: { id: true, type: true } },
  tags: { include: { tag: true } },
} as const satisfies Prisma.ConversationInclude;

export type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export const messageInclude = {
  author: { select: userSummarySelect },
} as const satisfies Prisma.MessageInclude;

export type MessageWithAuthor = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

// ====================== Serializadores ======================

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    orgId: user.orgId,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    isActive: user.isActive,
  };
}

export function toContactDto(contact: Contact): ContactDto {
  return {
    id: contact.id,
    orgId: contact.orgId,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    avatarUrl: contact.avatarUrl,
    notes: contact.notes,
    customFields: asRecord(contact.customFields),
    memorySummary: contact.memorySummary,
    memoryUpdatedAt: isoOrNull(contact.memoryUpdatedAt),
    createdAt: iso(contact.createdAt),
  };
}

export function toTagDto(tag: Tag): TagDto {
  return { id: tag.id, name: tag.name, color: tag.color };
}

export function toStageDto(stage: PipelineStage): PipelineStageDto {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    position: stage.position,
    isHumanHandoff: stage.isHumanHandoff,
    isDefault: stage.isDefault,
  };
}

export function toMessageDto(message: MessageWithAuthor): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    type: message.type,
    content: asRecord(message.content),
    status: message.status,
    authorId: message.authorId,
    author: message.author,
    isAiGenerated: message.isAiGenerated,
    errorMessage: message.errorMessage,
    createdAt: iso(message.createdAt),
  };
}

/**
 * Projeção do MessageDto para o VISITANTE anônimo do webchat: errorMessage
 * carrega strings de erro internas (provider de IA, pipeline) e NUNCA sai para
 * fora da org — o status (FAILED) basta para a UX de falha. Usada no relay do
 * namespace /webchat e nas rotas públicas /api/webchat/messages.
 */
export function sanitizeMessageForVisitor(message: MessageDto): MessageDto {
  return message.errorMessage === null ? message : { ...message, errorMessage: null };
}

export function toConversationDto(conversation: ConversationWithRelations): ConversationDto {
  return {
    id: conversation.id,
    orgId: conversation.orgId,
    contactId: conversation.contactId,
    contact: toContactDto(conversation.contact),
    channelId: conversation.channelId,
    channelType: conversation.channel.type,
    status: conversation.status,
    assigneeId: conversation.assigneeId,
    assignee: conversation.assignee,
    stageId: conversation.stageId,
    stagePosition: conversation.stagePosition,
    aiEnabled: conversation.aiEnabled,
    unreadCount: conversation.unreadCount,
    lastMessageAt: isoOrNull(conversation.lastMessageAt),
    lastMessagePreview: conversation.lastMessagePreview,
    tags: conversation.tags.map((ct) => toTagDto(ct.tag)),
    createdAt: iso(conversation.createdAt),
  };
}

/** Preview textual de uma mensagem para Conversation.lastMessagePreview. */
export function messagePreview(type: MessageType, content: Record<string, unknown>): string {
  if (typeof content.text === 'string' && content.text.length > 0) {
    return content.text.length > 120 ? `${content.text.slice(0, 117)}...` : content.text;
  }
  const labels: Record<MessageType, string> = {
    TEXT: '[texto]',
    IMAGE: '[imagem]',
    AUDIO: '[áudio]',
    VIDEO: '[vídeo]',
    DOCUMENT: '[documento]',
    STICKER: '[figurinha]',
    LOCATION: '[localização]',
    TEMPLATE: '[template]',
    SYSTEM: '[sistema]',
  };
  return labels[type];
}
