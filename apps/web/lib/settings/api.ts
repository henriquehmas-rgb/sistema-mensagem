import type {
  AutomationDto,
  ChannelDto,
  CreateChannelDto,
  CreateKnowledgeSourceDto,
  KnowledgeSourceDto,
  MessageTemplateDto,
  PaginatedDto,
  PipelineStageDto,
  Role,
  TagDto,
  TemplateStatus,
  UpsertAutomationDto,
  UserDto,
} from "@sm/shared";

import { api } from "@/lib/api";

function unwrapList<T>(response: T[] | PaginatedDto<T>): T[] {
  return Array.isArray(response) ? response : response.data;
}

// ---------------------------------------------------------------------------
// Etapas do pipeline — GET/POST/PATCH/DELETE /stages + POST /stages/reorder
// ---------------------------------------------------------------------------

export interface CreateStageInput {
  name: string;
  color: string;
  isHumanHandoff?: boolean;
}

export interface UpdateStageInput {
  name?: string;
  color?: string;
  isHumanHandoff?: boolean;
}

export function createStage(input: CreateStageInput): Promise<PipelineStageDto> {
  return api.post<PipelineStageDto>("/stages", { body: input });
}

export function updateStage(
  id: string,
  input: UpdateStageInput,
): Promise<PipelineStageDto> {
  return api.patch<PipelineStageDto>(`/stages/${id}`, { body: input });
}

export function deleteStage(id: string): Promise<void> {
  return api.delete<void>(`/stages/${id}`);
}

export function reorderStages(ids: string[]): Promise<void> {
  return api.post<void>("/stages/reorder", { body: { ids } });
}

// ---------------------------------------------------------------------------
// Tags — GET/POST/PATCH/DELETE /tags
// ---------------------------------------------------------------------------

export interface UpsertTagInput {
  name: string;
  color: string;
}

export function updateTag(id: string, input: Partial<UpsertTagInput>): Promise<TagDto> {
  return api.patch<TagDto>(`/tags/${id}`, { body: input });
}

export function deleteTag(id: string): Promise<void> {
  return api.delete<void>(`/tags/${id}`);
}

// ---------------------------------------------------------------------------
// Usuários — GET/POST/PATCH/DELETE /users (ADMIN)
// ---------------------------------------------------------------------------

export async function listUsers(): Promise<UserDto[]> {
  const response = await api.get<UserDto[] | PaginatedDto<UserDto>>("/users");
  return unwrapList(response);
}

export interface InviteUserInput {
  name: string;
  email: string;
  /** Senha temporária definida pelo admin no convite. */
  password: string;
  role: Role;
  departmentId?: string;
}

export function createUser(input: InviteUserInput): Promise<UserDto> {
  return api.post<UserDto>("/users", { body: input });
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  isActive?: boolean;
  departmentId?: string | null;
}

export function updateUser(id: string, input: UpdateUserInput): Promise<UserDto> {
  return api.patch<UserDto>(`/users/${id}`, { body: input });
}

// ---------------------------------------------------------------------------
// Follow-up - revisão humana, com uma pessoa-ponto-focal opcional
// ---------------------------------------------------------------------------

export interface FollowUpResponsibleUser {
  id: string;
  name: string;
  role: Role;
  departmentId: string | null;
}

export interface FollowUpConfigurationDto {
  responsibleUserId: string | null;
  responsibleUser: FollowUpResponsibleUser | null;
}

export function getFollowUpConfiguration(): Promise<FollowUpConfigurationDto> {
  return api.get<FollowUpConfigurationDto>("/follow-ups/configuration");
}

export function configureFollowUpResponsible(responsibleUserId: string | null): Promise<FollowUpConfigurationDto> {
  return api.patch<FollowUpConfigurationDto>("/follow-ups/configuration", { body: { responsibleUserId } });
}

// ---------------------------------------------------------------------------
// Canais — GET/POST/PATCH /channels (credenciais só na criação; nunca lidas)
// ---------------------------------------------------------------------------

export async function listChannels(): Promise<ChannelDto[]> {
  const response = await api.get<ChannelDto[] | PaginatedDto<ChannelDto>>("/channels");
  return unwrapList(response);
}

export function createChannel(input: CreateChannelDto): Promise<ChannelDto> {
  return api.post<ChannelDto>("/channels", { body: input });
}

export interface UpdateChannelInput {
  name?: string;
  status?: ChannelDto["status"];
  config?: Record<string, unknown>;
}

export function updateChannel(
  id: string,
  input: UpdateChannelInput,
): Promise<ChannelDto> {
  return api.patch<ChannelDto>(`/channels/${id}`, { body: input });
}

// ---------------------------------------------------------------------------
// IXC — configuração administrativa e consultas estritamente somente leitura
// ---------------------------------------------------------------------------

export interface IxcIntegrationDto {
  baseUrl: string;
  isEnabled: boolean;
  hasCredentials: boolean;
  lastTestedAt: string | null;
  lastTestSucceeded: boolean | null;
}

export interface ConfigureIxcInput {
  baseUrl: string;
  username: string;
  token?: string;
  isEnabled: boolean;
}

export interface IxcCustomerDto {
  id: string;
  name: string;
  tradeName: string | null;
  cpfCnpj: string | null;
  active: boolean | null;
  phone: string | null;
  mobilePhone: string | null;
  whatsapp: string | null;
  email: string | null;
  cityId: string | null;
}

export function getIxcConfiguration(): Promise<IxcIntegrationDto | null> {
  return api.get<IxcIntegrationDto | null>("/integrations/ixc");
}

export function configureIxc(input: ConfigureIxcInput): Promise<IxcIntegrationDto> {
  return api.put<IxcIntegrationDto>("/integrations/ixc", { body: input });
}

export function testIxc(): Promise<{ success: true }> {
  return api.post<{ success: true }>("/integrations/ixc/test");
}

export interface IxcAutoViabilityRuntimeConfigurationDto {
  source: "IXC_INMAP_AUTO_VIABILITY";
  version: string | null;
  usesExternalServer: boolean | null;
  hasBranch: boolean;
  hasNegotiationSubject: boolean;
  scheduleConfigured: boolean;
  readyForControlledCheck: boolean;
  observedAt: string;
}

/** Leitura administrativa: não envia endereço, telefone nem cria lead no IXC. */
export function getIxcAutoViabilityRuntimeConfiguration(): Promise<IxcAutoViabilityRuntimeConfigurationDto> {
  return api.get<IxcAutoViabilityRuntimeConfigurationDto>("/integrations/ixc/inmap/auto-viability/runtime-configuration");
}

// ---------------------------------------------------------------------------
// Olho de Deus — ADMIN, leitura técnica agregada e sem escrita externa
// ---------------------------------------------------------------------------

export interface OlhoDeDeusIntegrationDto {
  baseUrl: string;
  allowedHosts: string[];
  allowInsecureHttp: boolean;
  isEnabled: boolean;
  hasCredentials: boolean;
  lastTestedAt: string | null;
  lastTestSucceeded: boolean | null;
  access: "READ_ONLY";
  affectsRuntimeDecisions: false;
}

export interface ConfigureOlhoDeDeusInput {
  baseUrl: string;
  allowedHosts: string;
  apiKey?: string;
  allowInsecureHttp: boolean;
  isEnabled: boolean;
}

export function getOlhoDeDeusConfiguration(): Promise<OlhoDeDeusIntegrationDto | null> {
  return api.get<OlhoDeDeusIntegrationDto | null>("/integrations/olho-de-deus");
}

export function configureOlhoDeDeus(
  input: ConfigureOlhoDeDeusInput,
): Promise<OlhoDeDeusIntegrationDto> {
  return api.put<OlhoDeDeusIntegrationDto>("/integrations/olho-de-deus", { body: input });
}

export function testOlhoDeDeus(): Promise<{ success: true }> {
  return api.post<{ success: true }>("/integrations/olho-de-deus/test");
}

export function searchIxcCustomers(query: {
  id?: string;
  cpfCnpj?: string;
  phone?: string;
}): Promise<IxcCustomerDto[]> {
  return api.get<IxcCustomerDto[]>("/integrations/ixc/customers/search", { query });
}

// ---------------------------------------------------------------------------
// Dúvidas internas — o responsável orienta; a IA retoma o cliente
// ---------------------------------------------------------------------------

export type KnowledgeGapStatus = "PENDING" | "ANSWERED" | "APPLIED" | "DISMISSED";

export interface KnowledgeGapDto {
  id: string;
  status: KnowledgeGapStatus;
  reason: string;
  question: string;
  answer: string | null;
  dueAt: string | null;
  createdAt: string;
  department: { id: string; name: string } | null;
  responder: { id: string; name: string } | null;
  conversation: { id: string; protocol: string; caseSummary: string | null };
}

export function listKnowledgeGaps(status?: KnowledgeGapStatus): Promise<KnowledgeGapDto[]> {
  return api.get<KnowledgeGapDto[]>("/knowledge-gaps", { query: { status } });
}

export function answerKnowledgeGap(id: string, answer: string): Promise<KnowledgeGapDto> {
  return api.post<KnowledgeGapDto>(`/knowledge-gaps/${id}/answer`, { body: { answer } });
}

/** Fecha uma dúvida com registro interno. Não envia mensagem nem retoma a IA. */
export function dismissKnowledgeGap(id: string, note: string): Promise<KnowledgeGapDto> {
  return api.post<KnowledgeGapDto>(`/knowledge-gaps/${id}/dismiss`, { body: { note } });
}

// ---------------------------------------------------------------------------
// Templates WhatsApp — GET /channels/:id/templates + POST .../sync (§12)
// ---------------------------------------------------------------------------

export async function listChannelTemplates(
  channelId: string,
  status?: TemplateStatus,
): Promise<MessageTemplateDto[]> {
  const response = await api.get<MessageTemplateDto[] | PaginatedDto<MessageTemplateDto>>(
    `/channels/${channelId}/templates`,
    { query: { status } },
  );
  return unwrapList(response);
}

export function syncChannelTemplates(channelId: string): Promise<MessageTemplateDto[]> {
  return api.post<MessageTemplateDto[]>(`/channels/${channelId}/templates/sync`);
}

// ---------------------------------------------------------------------------
// Base de conhecimento — GET/POST/DELETE /knowledge
// ---------------------------------------------------------------------------

export async function listKnowledgeSources(): Promise<KnowledgeSourceDto[]> {
  const response = await api.get<KnowledgeSourceDto[] | PaginatedDto<KnowledgeSourceDto>>(
    "/knowledge",
  );
  return unwrapList(response);
}

export function createKnowledgeSource(
  input: CreateKnowledgeSourceDto,
): Promise<KnowledgeSourceDto> {
  return api.post<KnowledgeSourceDto>("/knowledge", { body: input });
}

export function deleteKnowledgeSource(id: string): Promise<void> {
  return api.delete<void>(`/knowledge/${id}`);
}

export type LearningCandidateStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface LearningCandidateDto {
  id: string;
  conversationId: string;
  intent: string | null;
  content: string;
  status: LearningCandidateStatus;
  qualityScore: number;
  recurrenceCount: number;
  autoPublishEligible: boolean;
  autoPublishedAt: string | null;
  createdAt: string;
}

export interface LearningPatternDto {
  fingerprint: string;
  intent: string | null;
  sample: string;
  occurrences7d: number;
  occurrences30d: number;
  occurrences90d: number;
  previous30d: number;
  growthPercent: number | null;
  averageQuality: number;
}

export function listLearningCandidates(): Promise<LearningCandidateDto[]> {
  return api.get<LearningCandidateDto[]>("/knowledge/candidates/review");
}

export function listLearningPatterns(): Promise<LearningPatternDto[]> {
  return api.get<LearningPatternDto[]>("/knowledge/patterns");
}

export function approveLearningCandidate(id: string): Promise<KnowledgeSourceDto> {
  return api.post<KnowledgeSourceDto>(`/knowledge/candidates/${id}/approve`);
}

export function rejectLearningCandidate(id: string): Promise<{ success: true }> {
  return api.post<{ success: true }>(`/knowledge/candidates/${id}/reject`);
}

// ---------------------------------------------------------------------------
// Automações — GET/POST/PATCH/DELETE /automations
// ---------------------------------------------------------------------------

export async function listAutomations(): Promise<AutomationDto[]> {
  const response = await api.get<AutomationDto[] | PaginatedDto<AutomationDto>>(
    "/automations",
  );
  return unwrapList(response);
}

export function createAutomation(input: UpsertAutomationDto): Promise<AutomationDto> {
  return api.post<AutomationDto>("/automations", { body: input });
}

export function updateAutomation(
  id: string,
  input: Partial<UpsertAutomationDto>,
): Promise<AutomationDto> {
  return api.patch<AutomationDto>(`/automations/${id}`, { body: input });
}

export function deleteAutomation(id: string): Promise<void> {
  return api.delete<void>(`/automations/${id}`);
}
