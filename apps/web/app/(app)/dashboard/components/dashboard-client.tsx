"use client";

import type { ReactNode } from "react";
import {
  Inbox,
  MessageSquareText,
  Timer,
  TrendingDown,
  TrendingUp,
  UserX,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChannelType, DashboardMetricsDto } from "@sm/shared";

import { QueryError } from "@/components/query-error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardMetrics } from "@/lib/dashboard/hooks";
import { cn } from "@/lib/utils";

import { CHANNEL_LABELS } from "../../inbox/components/channel-icons";

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

const numberFormatter = new Intl.NumberFormat("pt-BR");

function formatResponseTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

const CHANNEL_COLORS: Record<ChannelType, string> = {
  WHATSAPP: "#25D366",
  INSTAGRAM: "#E1306C",
  WEBCHAT: "#3B82F6",
};

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  color: "hsl(var(--popover-foreground))",
  boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
};

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  title: string;
  value: string;
  icon: LucideIcon;
  /** Variação % vs. período anterior (opcional). */
  delta?: number | undefined;
  /** true quando queda é bom (ex.: tempo de resposta). */
  lowerIsBetter?: boolean;
}

function StatCard({ title, value, icon: Icon, delta, lowerIsBetter }: StatCardProps) {
  const hasDelta = delta !== undefined && Number.isFinite(delta) && delta !== 0;
  const isPositiveChange = hasDelta && delta > 0;
  const isGood = hasDelta && (lowerIsBetter ? delta < 0 : delta > 0);

  return (
    <Card className="animate-fade-up">
      <CardContent className="flex items-start gap-3 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-muted-foreground">{title}</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
            {hasDelta ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  isGood
                    ? "bg-success/15 text-success"
                    : "bg-destructive/15 text-destructive",
                )}
                title="Variação vs. período anterior"
              >
                {isPositiveChange ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {isPositiveChange ? "+" : ""}
                {Math.round(delta)}%
              </span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 p-4">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart cards
// ---------------------------------------------------------------------------

function ChartCard({
  title,
  children,
  loading,
  empty,
}: {
  title: string;
  children: ReactNode;
  loading: boolean;
  empty: boolean;
}) {
  return (
    <Card className="animate-fade-up">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-64 p-4 pt-0">
        {loading ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : empty ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Sem dados no período.
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function StageBarChart({ metrics }: { metrics: DashboardMetricsDto }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={metrics.byStage} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="name"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          interval={0}
        />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value: number | string) => [
            numberFormatter.format(Number(value)),
            "Conversas",
          ]}
        />
        <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={44}>
          {metrics.byStage.map((stage) => (
            <Cell key={stage.stageId} fill={stage.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChannelDonutChart({ metrics }: { metrics: DashboardMetricsDto }) {
  const data = metrics.byChannel.map((item) => ({
    ...item,
    label: CHANNEL_LABELS[item.channelType],
  }));
  const total = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="flex h-full items-center gap-4">
      <div className="relative h-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number | string, name: string | number) => [
                numberFormatter.format(Number(value)),
                String(name),
              ]}
            />
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={3}
              strokeWidth={0}
            >
              {data.map((item) => (
                <Cell key={item.channelType} fill={CHANNEL_COLORS[item.channelType]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums">
            {numberFormatter.format(total)}
          </span>
          <span className="text-[10px] text-muted-foreground">conversas</span>
        </div>
      </div>
      <ul className="w-32 shrink-0 space-y-2">
        {data.map((item) => (
          <li key={item.channelType} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: CHANNEL_COLORS[item.channelType] }}
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {item.label}
            </span>
            <span className="font-medium tabular-nums">
              {numberFormatter.format(item.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentBarChart({ metrics }: { metrics: DashboardMetricsDto }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={metrics.byAgent}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis
          type="number"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: "hsl(var(--border))" }}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value: number | string) => [
            numberFormatter.format(Number(value)),
            "Conversas",
          ]}
        />
        <Bar
          dataKey="count"
          radius={[0, 6, 6, 0]}
          maxBarSize={20}
          fill="hsl(var(--chart-1))"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function DashboardClient() {
  const metricsQuery = useDashboardMetrics();
  const metrics = metricsQuery.data;
  const isLoading = metricsQuery.isLoading;

  if (metricsQuery.isError && !metrics) {
    return (
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <QueryError
            error={metricsQuery.error}
            retrying={metricsQuery.isFetching}
            onRetry={() => void metricsQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Atualiza automaticamente a cada 60s
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {isLoading || !metrics ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            <>
              <StatCard
                title="Conversas abertas"
                value={numberFormatter.format(metrics.openConversations)}
                icon={Inbox}
                delta={metrics.deltas?.openConversations}
              />
              <StatCard
                title="Não atribuídas"
                value={numberFormatter.format(metrics.unassignedConversations)}
                icon={UserX}
                delta={metrics.deltas?.unassignedConversations}
                lowerIsBetter
              />
              <StatCard
                title="Mensagens hoje"
                value={numberFormatter.format(metrics.messagesToday)}
                icon={MessageSquareText}
                delta={metrics.deltas?.messagesToday}
              />
              <StatCard
                title="Tempo 1ª resposta"
                value={formatResponseTime(metrics.avgFirstResponseSeconds)}
                icon={Timer}
                delta={metrics.deltas?.avgFirstResponseSeconds}
                lowerIsBetter
              />
            </>
          )}
        </div>

        {/* Gráficos */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard
            title="Conversas por etapa"
            loading={isLoading}
            empty={(metrics?.byStage.length ?? 0) === 0}
          >
            {metrics ? <StageBarChart metrics={metrics} /> : null}
          </ChartCard>
          <ChartCard
            title="Conversas por canal"
            loading={isLoading}
            empty={(metrics?.byChannel.length ?? 0) === 0}
          >
            {metrics ? <ChannelDonutChart metrics={metrics} /> : null}
          </ChartCard>
        </div>

        <ChartCard
          title="Conversas por agente"
          loading={isLoading}
          empty={(metrics?.byAgent.length ?? 0) === 0}
        >
          {metrics ? <AgentBarChart metrics={metrics} /> : null}
        </ChartCard>
      </div>
    </div>
  );
}
