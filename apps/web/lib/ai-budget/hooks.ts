"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acknowledgeAiBudgetAlert, getAiBudgetStatus } from "./api";

export const aiBudgetKey = ["ai-budget", "status"] as const;
export function useAiBudget(enabled: boolean) {
  return useQuery({ queryKey: aiBudgetKey, queryFn: getAiBudgetStatus, enabled, refetchInterval: 60_000 });
}
export function useAcknowledgeAiBudgetAlert() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: acknowledgeAiBudgetAlert,
    onSuccess: (data) => client.setQueryData(aiBudgetKey, data),
  });
}
