import type {
  ChannelType,
  Contact,
  ConversationStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  PipelineStage,
  Department,
  ResolutionReason,
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
  departmentId: string | null;
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

export interface DepartmentDto {
  id: string;
  name: string;
  description: string | null;
  color: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface ResolutionReasonDto {
  id: string;
  name: string;
  isActive: boolean;
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
  protocol: string;
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
  departmentId: string | null;
  department: DepartmentDto | null;
  resolutionReasonId: string | null;
  resolutionReason: ResolutionReasonDto | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  lastIntent: string | null;
  secondaryIntent: string | null;
  alternativeRouteKey: string | null;
  triageConflict: boolean;
  routingEvidence: string[];
  triageConfidence: number | null;
  triagedAt: string | null;
  caseSummary: string | null;
  clarificationCount: number;
  identityVerifiedAt: string | null;
  identityVerificationMethod: string | null;
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
  department: true,
  resolutionReason: true,
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
    departmentId: user.departmentId,
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

export function toDepartmentDto(department: Department): DepartmentDto {
  return {
    id: department.id,
    name: department.name,
    description: department.description,
    color: department.color,
    isDefault: department.isDefault,
    isActive: department.isActive,
  };
}

export function toResolutionReasonDto(reason: ResolutionReason): ResolutionReasonDto {
  return { id: reason.id, name: reason.name, isActive: reason.isActive };
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
  const text = typeof message.content.text === 'string' ? message.content.text : null;
  const protectedIdentityMarker = text !== null && /^\[(?:Identidade|Validação|Resposta de validação)/.test(text);
  // O marcador técnico não deve revelar fatores de identificação, mas também
  // não pode desaparecer da conversa: isso quebraria a cronologia visual.
  const content = protectedIdentityMarker
    ? { ...message.content, text: '•••.•••.•••-••', hiddenFromVisitor: false }
    : message.content;
  return { ...message, content, errorMessage: null };
}

export function toConversationDto(conversation: ConversationWithRelations): ConversationDto {
  return {
    id: conversation.id,
    protocol: conversation.protocol,
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
    departmentId: conversation.departmentId,
    department: conversation.department ? toDepartmentDto(conversation.department) : null,
    resolutionReasonId: conversation.resolutionReasonId,
    resolutionReason: conversation.resolutionReason
      ? toResolutionReasonDto(conversation.resolutionReason)
      : null,
    resolutionNote: conversation.resolutionNote,
    resolvedAt: isoOrNull(conversation.resolvedAt),
    lastIntent: conversation.lastIntent,
    secondaryIntent: conversation.secondaryIntent,
    alternativeRouteKey: conversation.alternativeRouteKey,
    triageConflict: conversation.triageConflict,
    routingEvidence: Array.isArray(conversation.routingEvidence)
      ? conversation.routingEvidence.filter((item): item is string => typeof item === 'string')
      : [],
    triageConfidence: conversation.triageConfidence,
    triagedAt: isoOrNull(conversation.triagedAt),
    caseSummary: conversation.caseSummary,
    clarificationCount: conversation.clarificationCount,
    identityVerifiedAt: conversation.identityVerifiedAt?.toISOString() ?? null,
    identityVerificationMethod: conversation.identityVerificationMethod,
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
