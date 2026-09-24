"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiError } from "@/lib/api";
import {
  listOperationalActionProposals,
  getHomologationPlan,
  reviewOperationalActionProposal,
  type OperationalActionRequestStatus,
} from "./api";

export function useHomologationPlan() {
  return useQuery({
    queryKey: ["operational-action-homologation-plan"],
    queryFn: getHomologationPlan,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

const proposalKeys = {
  all: ["operational-action-proposals"] as const,
  list: (status: OperationalActionRequestStatus) =>
    ["operational-action-proposals", status] as const,
};

export function useOperationalActionProposals(status: OperationalActionRequestStatus) {
  return useQuery({
    queryKey: proposalKeys.list(status),
    queryFn: () => listOperationalActionProposals(status),
    refetchInterval: status === "PENDING_REVIEW" ? 15_000 : false,
  });
}

export function useReviewOperationalActionProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: {
      id: string;
      decision: "APPROVED" | "REJECTED";
      note?: string;
    }) => reviewOperationalActionProposal(id, decision, note),
    onSuccess: (_, variables) => {
      toast.success(variables.decision === "APPROVED" ? "Proposta aprovada." : "Proposta rejeitada.");
      void queryClient.invalidateQueries({ queryKey: proposalKeys.all });
    },
    onError: (error) => toast.error(
      error instanceof ApiError ? error.friendlyMessage : "Não foi possível revisar a proposta.",
    ),
  });
}
