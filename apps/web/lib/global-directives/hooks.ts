"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { changeGlobalDirectiveStatus, createGlobalDirective, listGlobalDirectives, type CreateGlobalDirectiveInput } from "./api";

const key = ["global-directives"] as const;
const message = (error: unknown) => error instanceof ApiError ? error.friendlyMessage : "Não foi possível concluir a ação.";
export const useGlobalDirectives = () => useQuery({ queryKey: key, queryFn: listGlobalDirectives });
export const useCreateGlobalDirective = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: CreateGlobalDirectiveInput) => createGlobalDirective(input),
    onSuccess: () => { toast.success("Diretriz salva como rascunho."); void client.invalidateQueries({ queryKey: key }); },
    onError: (error) => toast.error(message(error)) });
};
export const useChangeGlobalDirectiveStatus = () => {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ id, status }: { id: string; status: "IN_REVIEW" | "APPROVED" | "ACTIVE" | "SUSPENDED" }) => changeGlobalDirectiveStatus(id, status),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }), onError: (error) => toast.error(message(error)) });
};
