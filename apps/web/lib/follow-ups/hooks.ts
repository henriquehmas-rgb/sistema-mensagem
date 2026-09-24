"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { listFollowUps, reviewFollowUp, type FollowUpStatus } from "./api";

const keys = {
  all: ["follow-ups"] as const,
  list: (status: FollowUpStatus) => ["follow-ups", status] as const,
};

export function useFollowUps(status: FollowUpStatus) {
  return useQuery({
    queryKey: keys.list(status),
    queryFn: () => listFollowUps(status),
    refetchInterval: status === "READY_FOR_REVIEW" ? 15_000 : false,
  });
}

export function useReviewFollowUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "CONTACTED" | "PAUSE" | "CANCEL" }) =>
      reviewFollowUp(id, decision),
    onSuccess: (_, variables) => {
      toast.success(
        variables.decision === "PAUSE" ? "Follow-up pausado." : "Follow-up cancelado.",
      );
      void queryClient.invalidateQueries({ queryKey: keys.all });
    },
    onError: (error) => toast.error(
      error instanceof ApiError ? error.friendlyMessage : "Não foi possível atualizar o follow-up.",
    ),
  });
}
