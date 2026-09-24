import { api } from "@/lib/api";

export type GlobalDirectiveStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "REPLACED";
export interface GlobalDirectiveDto {
  id: string; key: string; title: string; category: string; version: number;
  status: GlobalDirectiveStatus; priority: number; principles: string[];
  prohibitions: string[]; owner: string | null; validUntil: string | null;
}
export interface CreateGlobalDirectiveInput {
  key: string; title: string; category: string; priority: number;
  principles: string[]; prohibitions: string[]; owner: string; validUntil?: string;
}
export const listGlobalDirectives = () => api.get<GlobalDirectiveDto[]>("/global-directives");
export const createGlobalDirective = (body: CreateGlobalDirectiveInput) =>
  api.post<GlobalDirectiveDto>("/global-directives", { body });
export const changeGlobalDirectiveStatus = (
  id: string, status: "IN_REVIEW" | "APPROVED" | "ACTIVE" | "SUSPENDED",
) => api.patch<GlobalDirectiveDto>(`/global-directives/${id}/status`, { body: { status } });
