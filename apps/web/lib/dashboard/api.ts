import type { DashboardMetricsDto } from "@sm/shared";

import { api } from "@/lib/api";

/** Normaliza a resposta defensivamente (campos ausentes → zeros/listas vazias). */
function normalizeMetrics(raw: Partial<DashboardMetricsDto> | undefined): DashboardMetricsDto {
  return {
    openConversations: raw?.openConversations ?? 0,
    unassignedConversations: raw?.unassignedConversations ?? 0,
    messagesToday: raw?.messagesToday ?? 0,
    avgFirstResponseSeconds: raw?.avgFirstResponseSeconds ?? null,
    ...(raw?.deltas !== undefined ? { deltas: raw.deltas } : {}),
    byStage: raw?.byStage ?? [],
    byChannel: raw?.byChannel ?? [],
    byAgent: raw?.byAgent ?? [],
  };
}

/** GET /dashboard/metrics — docs/CONTRACTS.md §6. */
export async function getDashboardMetrics(): Promise<DashboardMetricsDto> {
  const raw = await api.get<Partial<DashboardMetricsDto>>("/dashboard/metrics");
  return normalizeMetrics(raw);
}
