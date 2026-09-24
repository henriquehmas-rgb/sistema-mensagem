import { api } from "@/lib/api";

export interface AiBudgetAlertDto {
  id: string; threshold: number; estimatedBrl: number; budgetBrl: number;
  recipientEmail: string; acknowledgedAt: string | null; createdAt: string;
}
export interface AiBudgetStatusDto {
  month: string; budgetBrl: number; estimatedBrl: number; percentage: number;
  reachedThreshold: number | null; nextThreshold: number | null;
  level: "NORMAL" | "WATCH" | "ELEVATED" | "CRITICAL";
  blocksService: false; estimationNotice: string; alerts: AiBudgetAlertDto[];
}

export const getAiBudgetStatus = () => api.get<AiBudgetStatusDto>("/ai-budget/status");
export const acknowledgeAiBudgetAlert = (id: string) =>
  api.patch<AiBudgetStatusDto>(`/ai-budget/alerts/${id}/acknowledge`);
