"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type {
  AutomationDto,
  CreateChannelDto,
  CreateKnowledgeSourceDto,
  PipelineStageDto,
  TagDto,
  UpsertAutomationDto,
} from "@sm/shared";

import { ApiError } from "@/lib/api";
import { inboxKeys } from "@/lib/inbox/keys";

import {
  createAutomation,
  createChannel,
  createKnowledgeSource,
  createStage,
  createUser,
  deleteAutomation,
  deleteKnowledgeSource,
  deleteStage,
  deleteTag,
  listAutomations,
  listChannels,
  listKnowledgeSources,
  listUsers,
  reorderStages,
  updateAutomation,
  updateChannel,
  updateStage,
  updateTag,
  updateUser,
  type CreateStageInput,
  type InviteUserInput,
  type UpdateChannelInput,
  type UpdateStageInput,
  type UpdateUserInput,
  type UpsertTagInput,
} from "./api";

export const settingsKeys = {
  users: ["users", "list"] as const,
  channels: ["channels"] as const,
  knowledge: ["knowledge"] as const,
  automations: ["automations"] as const,
};

function errorMessageOf(error: unknown): string {
  return error instanceof ApiError
    ? error.friendlyMessage
    : "Algo deu errado. Tente novamente.";
}

// ---------------------------------------------------------------------------
// Etapas (compartilham a query key da inbox/kanban → tudo atualiza junto)
// ---------------------------------------------------------------------------

export function useCreateStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStageInput) => createStage(input),
    onSuccess: () => {
      toast.success("Etapa criada.");
      void queryClient.invalidateQueries({ queryKey: inboxKeys.stages });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

export function useUpdateStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateStageInput }) =>
      updateStage(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.stages });
      const previous = queryClient.getQueryData<PipelineStageDto[]>(inboxKeys.stages);
      if (previous) {
        queryClient.setQueryData<PipelineStageDto[]>(
          inboxKeys.stages,
          previous.map((stage) => (stage.id === id ? { ...stage, ...input } : stage)),
        );
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(inboxKeys.stages, context.previous);
      }
      toast.error(errorMessageOf(error));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.stages });
    },
  });
}

export function useDeleteStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteStage(id),
    onSuccess: () => {
      toast.success("Etapa excluída.");
      void queryClient.invalidateQueries({ queryKey: inboxKeys.stages });
    },
    onError: (error) => {
      // 409: etapa em uso (conversas vinculadas) — bloqueio explicado.
      if (error instanceof ApiError && error.statusCode === 409) {
        toast.error("Não é possível excluir esta etapa", {
          description:
            "Existem conversas nesta etapa. Mova-as para outra etapa antes de excluir.",
        });
        return;
      }
      toast.error(errorMessageOf(error));
    },
  });
}

export function useReorderStages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => reorderStages(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.stages });
      const previous = queryClient.getQueryData<PipelineStageDto[]>(inboxKeys.stages);
      if (previous) {
        const byId = new Map(previous.map((stage) => [stage.id, stage]));
        const reordered = ids
          .map((id, index) => {
            const stage = byId.get(id);
            return stage ? { ...stage, position: index } : null;
          })
          .filter((stage): stage is PipelineStageDto => stage !== null);
        queryClient.setQueryData(inboxKeys.stages, reordered);
      }
      return { previous };
    },
    onError: (error, _ids, context) => {
      if (context?.previous) {
        queryClient.setQueryData(inboxKeys.stages, context.previous);
      }
      toast.error(errorMessageOf(error));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.stages });
    },
  });
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export function useUpdateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<UpsertTagInput> }) =>
      updateTag(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: inboxKeys.tags });
      const previous = queryClient.getQueryData<TagDto[]>(inboxKeys.tags);
      if (previous) {
        queryClient.setQueryData<TagDto[]>(
          inboxKeys.tags,
          previous.map((tag) => (tag.id === id ? { ...tag, ...input } : tag)),
        );
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(inboxKeys.tags, context.previous);
      }
      toast.error(errorMessageOf(error));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: inboxKeys.tags });
    },
  });
}

export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => {
      toast.success("Tag excluída.");
      void queryClient.invalidateQueries({ queryKey: inboxKeys.tags });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

// ---------------------------------------------------------------------------
// Usuários (ADMIN)
// ---------------------------------------------------------------------------

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.users,
    queryFn: listUsers,
    enabled,
    staleTime: 60_000,
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteUserInput) => createUser(input),
    onSuccess: (user) => {
      toast.success(`Convite criado para ${user.name}.`, {
        description: "Compartilhe a senha temporária com segurança.",
      });
      void queryClient.invalidateQueries({ queryKey: settingsKeys.users });
      void queryClient.invalidateQueries({ queryKey: inboxKeys.agents });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      updateUser(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.users });
      void queryClient.invalidateQueries({ queryKey: inboxKeys.agents });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------

export function useChannels() {
  return useQuery({
    queryKey: settingsKeys.channels,
    queryFn: listChannels,
    staleTime: 60_000,
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChannelDto) => createChannel(input),
    onSuccess: (channel) => {
      toast.success(`Canal "${channel.name}" conectado.`);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.channels });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateChannelInput }) =>
      updateChannel(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.channels });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

// ---------------------------------------------------------------------------
// Base de conhecimento (auto-refresh enquanto houver ingestão em andamento)
// ---------------------------------------------------------------------------

const KNOWLEDGE_POLL_MS = 5_000;

export function useKnowledgeSources() {
  return useQuery({
    queryKey: settingsKeys.knowledge,
    queryFn: listKnowledgeSources,
    refetchInterval: (query) => {
      const sources = query.state.data;
      const hasInFlight = sources?.some(
        (source) => source.status === "PENDING" || source.status === "PROCESSING",
      );
      return hasInFlight ? KNOWLEDGE_POLL_MS : false;
    },
    staleTime: 15_000,
  });
}

export function useCreateKnowledgeSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKnowledgeSourceDto) => createKnowledgeSource(input),
    onSuccess: () => {
      toast.success("Fonte adicionada.", {
        description: "A ingestão começa em instantes.",
      });
      void queryClient.invalidateQueries({ queryKey: settingsKeys.knowledge });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

export function useDeleteKnowledgeSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteKnowledgeSource(id),
    onSuccess: () => {
      toast.success("Fonte removida da base de conhecimento.");
      void queryClient.invalidateQueries({ queryKey: settingsKeys.knowledge });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

// ---------------------------------------------------------------------------
// Automações
// ---------------------------------------------------------------------------

export function useAutomations() {
  return useQuery({
    queryKey: settingsKeys.automations,
    queryFn: listAutomations,
    staleTime: 30_000,
  });
}

export function useCreateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertAutomationDto) => createAutomation(input),
    onSuccess: () => {
      toast.success("Automação criada.");
      void queryClient.invalidateQueries({ queryKey: settingsKeys.automations });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<UpsertAutomationDto> }) =>
      updateAutomation(id, input),
    // Otimista — usado no switch enabled da listagem.
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: settingsKeys.automations });
      const previous = queryClient.getQueryData<AutomationDto[]>(
        settingsKeys.automations,
      );
      if (previous) {
        queryClient.setQueryData<AutomationDto[]>(
          settingsKeys.automations,
          previous.map((automation) =>
            automation.id === id ? { ...automation, ...input } : automation,
          ),
        );
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(settingsKeys.automations, context.previous);
      }
      toast.error(errorMessageOf(error));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.automations });
    },
  });
}

export function useDeleteAutomation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: () => {
      toast.success("Automação excluída.");
      void queryClient.invalidateQueries({ queryKey: settingsKeys.automations });
    },
    onError: (error) => toast.error(errorMessageOf(error)),
  });
}
