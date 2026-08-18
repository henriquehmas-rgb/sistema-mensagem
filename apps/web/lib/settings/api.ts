import type {
  AutomationDto,
  ChannelDto,
  CreateChannelDto,
  CreateKnowledgeSourceDto,
  KnowledgeSourceDto,
  PaginatedDto,
  PipelineStageDto,
  Role,
  TagDto,
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
}

export function createUser(input: InviteUserInput): Promise<UserDto> {
  return api.post<UserDto>("/users", { body: input });
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  isActive?: boolean;
}

export function updateUser(id: string, input: UpdateUserInput): Promise<UserDto> {
  return api.patch<UserDto>(`/users/${id}`, { body: input });
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
