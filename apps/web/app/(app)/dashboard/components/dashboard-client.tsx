"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Inbox,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
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
import {
  useLearningCandidates,
  useLearningPatterns,
} from "@/lib/settings/hooks";
import { useAuthStore } from "@/lib/stores/auth";
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

function IntelligenceOverview() {
  const role = useAuthStore((state) => state.user?.role);
  const canReview = role === "ADMIN" || role === "SUPERVISOR";
  const patternsQuery = useLearningPatterns(canReview);
  const candidatesQuery = useLearningCandidates(canReview);
  if (!canReview) return null;

  const patterns = patternsQuery.data ?? [];
  const pending = (candidatesQuery.data ?? []).filter((item) => item.status === "PENDING");
  const occurrences30d = patterns.reduce((sum, item) => sum + item.occurrences30d, 0);
  const topPattern = patterns[0];

  return (
    <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card to-card">
      <CardHeader className="flex flex-row items-start justify-between gap-4 p-5 pb-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <BrainCircuit className="h-5 w-5" />
            <CardTitle className="text-base text-foreground">Inteligência de atendimento</CardTitle>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Acompanhe o que a IA está entendendo, o que aprendeu com a equipe e quais assuntos estão crescendo.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Camada ativa
        </span>
      </CardHeader>
      <CardContent className="grid gap-3 p-5 pt-2 md:grid-cols-3">
        <div className="rounded-xl border bg-background/70 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" /> Revisão humana
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{pending.length}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {pending.length === 0 ? "Nenhuma solução aguardando decisão." : "Soluções coerentes aguardando aprovação."}
          </p>
        </div>
        <div className="rounded-xl border bg-background/70 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" /> Recorrência em 30 dias
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{occurrences30d}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Casos sanitizados usados na análise de padrões.
          </p>
        </div>
        <div className="rounded-xl border bg-background/70 p-4">
          <div className="text-xs font-medium text-muted-foreground">Assunto em destaque</div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold">
            {topPattern
              ? (topPattern.sample.split("\n")[0] ?? topPattern.sample).replace(
                  "Pergunta recorrente: ",
                  "",
                )
              : "Aguardando atendimentos resolvidos"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {topPattern ? `${topPattern.occurrences30d} ocorrência(s) nos últimos 30 dias.` : "O primeiro padrão aparecerá aqui automaticamente."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Painel deliberadamente isolado: os números abaixo são apenas do setor Suporte. */
function SupportPilotOverview({ metrics }: { metrics: DashboardMetricsDto }) {
  const pilot = metrics.supportPilot;
  if (!pilot) return null;

  const routedWithAttention = pilot.triageConflicts + pilot.lowConfidenceTriages;

  return (
    <Card className="overflow-hidden border-sky-500/25 bg-gradient-to-br from-sky-500/[0.08] via-card to-card">
      <CardHeader className="flex flex-row items-start justify-between gap-4 p-5 pb-3">
        <div>
          <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
            <ShieldCheck className="h-5 w-5" />
            <CardTitle className="text-base text-foreground">Piloto de Suporte</CardTitle>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Indicadores agregados dos últimos {pilot.periodDays} dias. Financeiro e Vendas não entram neste painel.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-700 dark:text-sky-300">
          Em homologação
        </span>
      </CardHeader>
      <CardContent className="grid gap-3 p-5 pt-2 sm:grid-cols-2 xl:grid-cols-4">
        <SupportPilotMetric
          label="Resolvidos"
          value={`${numberFormatter.format(pilot.resolved)} / ${numberFormatter.format(pilot.conversations)}`}
          detail="conversas concluídas no período"
        />
        <SupportPilotMetric
          label="Sem GAP"
          value={numberFormatter.format(pilot.resolvedWithoutGap)}
          detail="resolvidas sem abrir dúvida interna"
        />
        <SupportPilotMetric
          label="Em acompanhamento"
          value={numberFormatter.format(pilot.active)}
          detail="casos de suporte ainda abertos ou pendentes"
        />
        <SupportPilotMetric
          label="GAPs pendentes"
          value={numberFormatter.format(pilot.pendingKnowledgeGaps)}
          detail={`${numberFormatter.format(pilot.answeredKnowledgeGaps)} respondido(s) · ${numberFormatter.format(pilot.dismissedKnowledgeGaps)} descartado(s)`}
        />
        <SupportPilotMetric
          label="Triagem a revisar"
          value={numberFormatter.format(routedWithAttention)}
          detail="conflito de rota ou confiança abaixo de 80%"
        />
        <SupportPilotMetric
          label="Confirmações repetidas"
          value={numberFormatter.format(pilot.conversationsWithRepeatedClarification)}
          detail="mesma etapa solicitada novamente"
        />
        <SupportPilotMetric
          label="Modo sombra"
          value={`${numberFormatter.format(pilot.pendingShadowProposals)} / ${numberFormatter.format(pilot.shadowProposalsCreated)}`}
          detail="propostas pendentes / propostas criadas"
        />
        <SupportPilotMetric
          label="Aprendizagem"
          value={numberFormatter.format(pilot.pendingLearningCandidates)}
          detail={`${numberFormatter.format(pilot.autoPublishedLanguageCandidates)} melhoria(s) de linguagem publicada(s)`}
        />
        <SupportPilotMetric
          label="Rastreabilidade factual"
          value={`${numberFormatter.format(pilot.aiRepliesWithTrace)} / ${numberFormatter.format(pilot.aiRepliesWithoutTrace)}`}
          detail="respostas que exigiam fonte: com / sem evidência"
        />
        <SupportPilotMetric
          label="Amostras a classificar"
          value={numberFormatter.format(pilot.unclassifiedAiReplies)}
          detail="respostas legadas ou ainda sem expectativa de rastro"
        />
        <SupportPilotMetric
          label="IXC + rede"
          value={`${numberFormatter.format(pilot.networkBoxWithIndependentNetworkEvent)} / ${numberFormatter.format(pilot.networkBoxEvaluations)}`}
          detail={`${numberFormatter.format(pilot.networkBoxCohortsObserved)} coorte(s) observada(s) · ${numberFormatter.format(pilot.networkBoxInsufficientEvidence)} evidência(s) insuficiente(s)`}
        />
        <SupportPilotMetric
          label="1ª resposta"
          value={pilot.avgFirstResponseSeconds === null ? '—' : `${numberFormatter.format(pilot.avgFirstResponseSeconds)}s`}
          detail="média no Suporte; resposta humana ou IA"
        />
      </CardContent>
    </Card>
  );
}

function SupportPilotMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border bg-background/70 p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

const SECTOR_LABELS = {
  technical_support: "Suporte",
  billing: "Financeiro",
  sales: "Vendas",
} as const;

const READINESS_STYLE = {
  CONTROLLED_USE: {
    label: "Uso controlado",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  SHADOW_ONLY: {
    label: "Modo sombra",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  HOLD: {
    label: "Pausar e revisar",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
} as const;

/** Critérios de liberação em leitura: não alteram a operação de nenhum setor. */
function OperationalReadinessOverview({ metrics }: { metrics: DashboardMetricsDto }) {
  const readiness = metrics.operationalReadiness;
  if (!readiness?.length) return null;

  return (
    <Card className="overflow-hidden border-violet-500/25 bg-gradient-to-br from-violet-500/[0.08] via-card to-card">
      <CardHeader className="p-5 pb-3">
        <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
          <AlertTriangle className="h-5 w-5" />
          <CardTitle className="text-base text-foreground">Critérios de liberação</CardTitle>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Decisão calculada com a janela dos últimos 30 dias. Incidentes de integração ficam como alerta e não viram GAP de aprendizagem. Ações reais continuam bloqueadas.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 p-5 pt-2 lg:grid-cols-3">
        {readiness.map((item) => {
          const style = READINESS_STYLE[item.status];
          const blockers = item.blockers.length > 0 ? item.blockers : ["critérios atuais atendidos"];
          return (
            <div key={item.sector} className="rounded-xl border bg-background/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{SECTOR_LABELS[item.sector]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {numberFormatter.format(item.conversations)} / {numberFormatter.format(item.minimumSample)} conversas na amostra
                  </p>
                </div>
                <span className={cn("rounded-full border px-2 py-1 text-[11px] font-medium", style.className)}>
                  {style.label}
                </span>
              </div>
              <div className="mt-3 space-y-1 text-xs leading-relaxed text-muted-foreground">
                {blockers.map((reason) => <p key={reason}>• {reason}</p>)}
                {item.advisories.map((advisory) => <p key={advisory}>• {advisory}</p>)}
              </div>
              <p className="mt-3 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">Próximo passo: {item.nextAction}.</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Pré-checagem visível, sem qualquer comando de ativação ou entrega externa. */
function IntegrationActivationOverview({ metrics }: { metrics: DashboardMetricsDto }) {
  const readiness = metrics.integrationActivationReadiness;
  if (!readiness) return null;

  return (
    <Card className="overflow-hidden border-sky-500/25 bg-gradient-to-br from-sky-500/[0.08] via-card to-card">
      <CardHeader className="p-5 pb-3">
        <div className="flex items-center gap-2 text-sky-700 dark:text-sky-300">
          <AlertTriangle className="h-5 w-5" />
          <CardTitle className="text-base text-foreground">Pré-checagem de integrações reais</CardTitle>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Esta leitura prepara a homologação; ela não altera o modo sombra nem envia mensagens para clientes.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 p-5 pt-2 lg:grid-cols-3">
        {readiness.channels.map((channel) => (
          <div key={channel.channel} className="rounded-xl border bg-background/70 p-4">
            <p className="font-semibold">{channel.channel === "WHATSAPP" ? "WhatsApp" : "Instagram Direct"}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {channel.approvedTemplates} template(s) aprovado(s)
            </p>
            <div className="mt-3 space-y-1 text-xs leading-relaxed text-muted-foreground">
              {(channel.blockers.length > 0 ? channel.blockers : ["pronto para revisão humana"]).map((item) => <p key={item}>• {item}</p>)}
            </div>
          </div>
        ))}
        <div className="rounded-xl border bg-background/70 p-4">
          <p className="font-semibold">Rede e observabilidade</p>
          <div className="mt-2 space-y-1 text-xs leading-relaxed text-muted-foreground">
            <p>• {readiness.confirmedTopologyMappings} mapeamento(s) técnico(s) confirmado(s)</p>
            <p>• {readiness.shadowTopologyMappings} mapeamento(s) em modo sombra</p>
            <p>• alertas externos: {readiness.sentryConfigured ? "configurados" : "pendentes"}</p>
            {readiness.networkDecisionBlocker ? <p>• {readiness.networkDecisionBlocker}</p> : null}
          </div>
        </div>
      </CardContent>
    </Card>
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
        <IntelligenceOverview />
        {metrics ? <SupportPilotOverview metrics={metrics} /> : null}
        {metrics ? <OperationalReadinessOverview metrics={metrics} /> : null}
        {metrics ? <IntegrationActivationOverview metrics={metrics} /> : null}
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
