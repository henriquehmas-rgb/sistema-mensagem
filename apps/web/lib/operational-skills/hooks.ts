"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  changeOperationalSkillStatus,
  createOperationalSkill,
  listOperationalSkills,
  type CreateOperationalSkillInput,
} from "./api";

const skillsKey = ["operational-skills"] as const;
const errorText = (error: unknown) => error instanceof ApiError
  ? error.friendlyMessage
  : "Não foi possível concluir a ação.";

export const useOperationalSkills = () => useQuery({
  queryKey: skillsKey,
  queryFn: listOperationalSkills,
});

export function useCreateOperationalSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOperationalSkillInput) => createOperationalSkill(input),
    onSuccess: () => {
      toast.success("Protocolo salvo como rascunho.");
      void queryClient.invalidateQueries({ queryKey: skillsKey });
    },
    onError: (error) => toast.error(errorText(error)),
  });
}

export function useChangeOperationalSkillStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: {
      id: string;
      status: "IN_REVIEW" | "APPROVED" | "ACTIVE" | "SUSPENDED";
    }) => changeOperationalSkillStatus(id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: skillsKey }),
    onError: (error) => toast.error(errorText(error)),
  });
}
