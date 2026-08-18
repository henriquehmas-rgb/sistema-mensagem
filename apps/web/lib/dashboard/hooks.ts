"use client";

import { useQuery } from "@tanstack/react-query";

import { getDashboardMetrics } from "./api";

export const dashboardKeys = {
  metrics: ["dashboard", "metrics"] as const,
};

/** Auto-refresh a cada 60s (mesmo em background da aba). */
const DASHBOARD_REFRESH_MS = 60_000;

export function useDashboardMetrics() {
  return useQuery({
    queryKey: dashboardKeys.metrics,
    queryFn: getDashboardMetrics,
    refetchInterval: DASHBOARD_REFRESH_MS,
    staleTime: 30_000,
  });
}
