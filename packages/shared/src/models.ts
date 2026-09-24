// Formas serializadas (JSON) dos recursos trafegados na API e no Socket.io.
// Datas sempre como ISO string. Manter em sincronia com docs/CONTRACTS.md §3.

import type {
  ChannelStatus,
  ChannelType,
  ConversationStatus,
  IngestStatus,
  MessageDirection,
  MessageStatus,
  MessageType,
  Role,
  SourceType,
} from "./enums";

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

export type MessageContent = (
  | { text: string }
  | {
      mediaUrl: string;
      mimeType: string;
      caption?: string;
      filename?: string;
      durationSeconds?: number;
    }
  | { templateName: string; language?: string; params?: string[] }
  | { latitude: number; longitude: number; name?: string; address?: string }
) & { hiddenFromVisitor?: boolean };

export interface MessageDto {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: MessageContent;
  status: MessageStatus;
  authorId: string | null;
  author?: Pick<UserDto, "id" | "name" | "avatarUrl"> | null;
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
  assignee?: Pick<UserDto, "id" | "name" | "avatarUrl"> | null;
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

// ---------------------------------------------------------------------------
// Canais (docs/CONTRACTS.md §3/§6 — credenciais NUNCA retornadas pela API)
// ---------------------------------------------------------------------------

export interface ChannelDto {
  id: string;
  orgId: string;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  /** Config não sensível (ex.: orgSlug do webchat). */
  config: Record<string, unknown>;
  /** phone_number_id (WhatsApp) / ig business id (Instagram). */
  externalId: string | null;
  createdAt: string;
}

/** Credenciais sensíveis — enviadas só na criação/edição (AES-256-GCM em repouso). */
export interface ChannelCredentialsDto {
  phoneNumberId?: string;
  wabaId?: string;
  igBusinessId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
}

export interface CreateChannelDto {
  type: ChannelType;
  name: string;
  config?: Record<string, unknown>;
  credentials?: ChannelCredentialsDto;
}

// ---------------------------------------------------------------------------
// Templates WhatsApp (docs/CONTRACTS.md §12) — sincronizados via Graph API
// ---------------------------------------------------------------------------

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export type TemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED";

/** Estrutura crua de um componente de template (header/body/footer/buttons). */
export interface TemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS" | string;
  format?: string;
  text?: string;
  buttons?: unknown[];
  [key: string]: unknown;
}

export interface MessageTemplateDto {
  id: string;
  orgId: string;
  channelId: string;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  components: TemplateComponent[];
  bodyParamsCount: number;
  lastSyncedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Base de conhecimento (RAG)
// ---------------------------------------------------------------------------

export interface KnowledgeSourceDto {
  id: string;
  type: SourceType;
  name: string;
  status: IngestStatus;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  authority: number;
  validUntil: string | null;
}

export interface CreateKnowledgeSourceDto {
  type: SourceType;
  name: string;
  /** Origem por URL (type URL/PDF) — CONTRACTS §6. */
  contentUrl?: string;
  /** Conteúdo colado (type TEXT/TABLE) — CONTRACTS §6. */
  contentText?: string;
  /** Autoridade editorial de 0 a 100; padrão 50. */
  authority?: number;
  /** Data ISO após a qual a fonte deixa de participar do RAG. */
  validUntil?: string;
}

// ---------------------------------------------------------------------------
// Automações — formas dos campos JSON trigger/conditions/actions
// ---------------------------------------------------------------------------

export const AutomationTriggerTypes = [
  "conversation.created",
  "message.received",
  "tag.added",
  "conversation.moved",
  "no.reply",
] as const;
export type AutomationTriggerType = (typeof AutomationTriggerTypes)[number];

export interface AutomationTrigger {
  type: AutomationTriggerType;
  /** Somente para `no.reply`: minutos sem resposta. */
  minutes?: number;
}

export const AutomationConditionFields = [
  "channel",
  "tag",
  "stage",
  "businessHours",
] as const;
export type AutomationConditionField = (typeof AutomationConditionFields)[number];

export const AutomationConditionOperators = ["is", "is_not"] as const;
export type AutomationConditionOperator =
  (typeof AutomationConditionOperators)[number];

/** Linha de condição — todas as linhas combinadas com AND. */
export interface AutomationCondition {
  field: AutomationConditionField;
  operator: AutomationConditionOperator;
  /** ChannelType | tagId | stageId | "inside"/"outside" (businessHours). */
  value: string;
}

// Alinhado com apps/api/src/automations/automation.types.ts (AutomationAction) —
// o payload é enviado sem transformação ao POST/PATCH /automations (CONTRACTS §12).
// `send_template` referencia o MessageTemplate por `templateId` (não por nome —
// nomes colidem entre canais/idiomas diferentes).
export type AutomationAction =
  | { type: "assign"; userId: string }
  | { type: "add_tag"; tagId: string }
  | { type: "move_stage"; stageId: string }
  | { type: "send_template"; templateId: string; params?: string[] };

export type AutomationActionType = AutomationAction["type"];

export interface AutomationDto {
  id: string;
  orgId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  runCount: number;
  createdAt: string;
}

export interface UpsertAutomationDto {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}

// ---------------------------------------------------------------------------
// Dashboard (GET /dashboard/metrics)
// ---------------------------------------------------------------------------

export interface DashboardStageMetricDto {
  stageId: string;
  name: string;
  color: string;
  count: number;
}

export interface DashboardChannelMetricDto {
  channelType: ChannelType;
  count: number;
}

export interface DashboardAgentMetricDto {
  userId: string;
  name: string;
  avatarUrl?: string | null;
  count: number;
}

/** Acompanhamento agregado do piloto de Suporte. Não contém cliente, contato ou mensagem. */
export interface SupportPilotMetricsDto {
  periodDays: number;
  conversations: number;
  resolved: number;
  /** Resolvidas sem abertura de GAP em nenhum momento da conversa. */
  resolvedWithoutGap: number;
  active: number;
  triageConflicts: number;
  lowConfidenceTriages: number;
  /** Sinal de fricção confirmado: a mesma etapa foi solicitada novamente. */
  conversationsWithRepeatedClarification: number;
  pendingKnowledgeGaps: number;
  answeredKnowledgeGaps: number;
  /** GAPs que foram revisados e descartados; não significa, isoladamente, erro da IA. */
  dismissedKnowledgeGaps: number;
  /** Falhas de IXC, identidade ou provedor; acompanhadas como incidente, nunca como aprendizagem. */
  technicalIncidents: number;
  /** Casos com evidência insuficiente ou baixa confiança que pedem revisão operacional. */
  operationalReviews: number;
  pendingShadowProposals: number;
  shadowProposalsCreated: number;
  pendingLearningCandidates: number;
  autoPublishedLanguageCandidates: number;
  /** Respostas que exigiam evidência e registraram ao menos uma fonte. */
  aiRepliesWithTrace: number;
  /** Respostas que exigiam evidência, mas não registraram fonte. */
  aiRepliesWithoutTrace: number;
  /** Respostas legadas ou sem classificação suficiente; não entram na cobertura factual. */
  unclassifiedAiReplies: number;
  /** Avaliações IXC caixa -> Olho de Deus mantidas em modo sombra. */
  networkBoxEvaluations: number;
  /** Coortes por caixa observadas no IXC, sem confirmação automática de impacto. */
  networkBoxCohortsObserved: number;
  /** Coortes com evento de rede independente no ODG; ainda não implica cliente afetado. */
  networkBoxWithIndependentNetworkEvent: number;
  /** Sem caixa, fonte indisponível ou ambiguidade: serve para corrigir dados/integração. */
  networkBoxInsufficientEvidence: number;
  /** Média até a primeira resposta humana ou IA, somente nas conversas de Suporte. */
  avgFirstResponseSeconds: number | null;
}

export type OperationalSectorKey = "technical_support" | "billing" | "sales";
export type OperationalReadinessStatus = "HOLD" | "SHADOW_ONLY" | "CONTROLLED_USE";

export type ActivationReadinessStatus = "BLOCKED" | "PREPARING" | "READY_FOR_REVIEW";

export interface ExternalChannelActivationReadinessDto {
  channel: "WHATSAPP" | "INSTAGRAM";
  status: ActivationReadinessStatus;
  approvedTemplates: number;
  blockers: string[];
}

/** Checklist somente leitura para preparar canais e evidência de rede reais. */
export interface IntegrationActivationReadinessDto {
  status: ActivationReadinessStatus;
  effectiveMode: "SHADOW";
  externalDeliveryEnabled: false;
  sentryConfigured: boolean;
  confirmedTopologyMappings: number;
  shadowTopologyMappings: number;
  channels: ExternalChannelActivationReadinessDto[];
  blockers: string[];
  networkDecisionBlocker: string | null;
  manualRequirements: string[];
}

/**
 * Parecer calculado a partir de métricas agregadas. Não habilita ações reais
 * e não contém cliente, conversa ou conteúdo de mensagens.
 */
export interface OperationalReadinessDto {
  sector: OperationalSectorKey;
  status: OperationalReadinessStatus;
  minimumSample: number;
  conversations: number;
  triageAttentionRate: number | null;
  repeatedClarificationRate: number | null;
  traceCoverage: number | null;
  blockers: string[];
  advisories: string[];
  nextAction: string;
}

export interface DashboardMetricsDto {
  openConversations: number;
  unassignedConversations: number;
  messagesToday: number;
  /** Média (segundos) até a 1ª resposta humana/IA; null sem dados no período. */
  avgFirstResponseSeconds: number | null;
  /** Variação percentual vs. período anterior (opcional; ocultada se ausente). */
  deltas?: {
    openConversations?: number;
    unassignedConversations?: number;
    messagesToday?: number;
    avgFirstResponseSeconds?: number;
  };
  byStage: DashboardStageMetricDto[];
  byChannel: DashboardChannelMetricDto[];
  byAgent: DashboardAgentMetricDto[];
  /** Presente quando o setor Suporte está configurado. Dados agregados dos últimos 30 dias. */
  supportPilot?: SupportPilotMetricsDto;
  /** Critérios consistentes para Suporte, Financeiro e Vendas, sempre em leitura. */
  operationalReadiness?: OperationalReadinessDto[];
  integrationActivationReadiness?: IntegrationActivationReadinessDto;
}
