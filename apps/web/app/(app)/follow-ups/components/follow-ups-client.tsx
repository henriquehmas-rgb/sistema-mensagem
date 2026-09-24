"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock3, Pause, Send, X } from "lucide-react";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { FollowUpDto, FollowUpStatus } from "@/lib/follow-ups/api";
import { useFollowUps, useReviewFollowUp } from "@/lib/follow-ups/hooks";
import { useAuthStore } from "@/lib/stores/auth";

const FILTERS: Array<{ value: FollowUpStatus; label: string }> = [
  { value: "READY_FOR_REVIEW", label: "Para revisar" },
  { value: "SCHEDULED", label: "Agendados" },
  { value: "PAUSED", label: "Pausados" },
  { value: "COMPLETED", label: "Concluídos" },
  { value: "CANCELLED", label: "Cancelados" },
];

const variants: Record<FollowUpStatus, "warning" | "secondary" | "success" | "destructive"> = {
  READY_FOR_REVIEW: "warning", SCHEDULED: "secondary", PAUSED: "secondary",
  COMPLETED: "success", CANCELLED: "destructive",
};

function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

export function FollowUpsClient() {
  const user = useAuthStore((state) => state.user);
  const [status, setStatus] = useState<FollowUpStatus>("READY_FOR_REVIEW");
  const query = useFollowUps(status);
  const review = useReviewFollowUp();
  const allowed = user?.role === "ADMIN" || user?.role === "SUPERVISOR";

  const act = async (item: FollowUpDto, decision: "PAUSE" | "CANCEL") => {
    const prompt = decision === "PAUSE" ? "Pausar este follow-up?" : "Cancelar este follow-up?";
    if (window.confirm(prompt)) await review.mutateAsync({ id: item.id, decision });
  };

  if (!allowed) return <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Esta área é exclusiva para responsáveis pela revisão.</div>;

  return (
    <main className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <div className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-primary" /><h1 className="text-lg font-semibold">Follow-ups</h1></div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Cadência controlada de vendas em 1, 3, 7 e 14 dias. A fila nunca envia mensagens sozinha; cada contato é revisado e realizado por uma pessoa.</p>
        </header>
        <Card className="border-primary/20 bg-primary/[0.02]"><CardContent className="p-4 text-sm">
          <p className="font-medium">Como a sequência funciona</p>
          <p className="mt-1 text-muted-foreground">O cliente autoriza o retorno. Se responder, pedir para parar ou a conversa for assumida, a sequência pausa. Depois do contato humano registrado, somente o próximo marco volta para revisão.</p>
        </CardContent></Card>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar follow-ups">
          {FILTERS.map((filter) => <Button key={filter.value} size="sm" variant={status === filter.value ? "default" : "outline"} onClick={() => setStatus(filter.value)}>{filter.label}</Button>)}
        </div>
        {query.isError ? <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} /> : query.isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-44 w-full" />)}</div>
        ) : query.data?.length === 0 ? (
          <Card><CardContent className="flex min-h-48 flex-col items-center justify-center text-center"><Clock3 className="mb-3 h-8 w-8 text-muted-foreground/50" /><p className="font-medium">Nenhum follow-up nesta lista</p><p className="mt-1 text-sm text-muted-foreground">Quando houver consentimento e chegar o momento de revisar, ele aparecerá aqui.</p></CardContent></Card>
        ) : <div className="space-y-3">{query.data?.map((item) => (
          <Card key={item.id}><CardContent className="p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2"><Badge variant={variants[item.status]}>{FILTERS.find((f) => f.value === item.status)?.label ?? item.status}</Badge><Badge variant="outline">Etapa {item.currentStep} de 4</Badge><span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span></div>
              <div><h2 className="font-semibold">{item.conversation.contact?.name || "Contato sem nome"}</h2><p className="mt-1 text-sm text-muted-foreground">{item.conversation.caseSummary || "Sem resumo disponível."}</p></div>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Protocolo</dt><dd className="font-medium">{item.conversation.protocol}</dd></div>
                <div><dt className="text-muted-foreground">Canal</dt><dd className="font-medium">{item.conversation.channel?.name || "Não informado"}</dd></div>
                <div><dt className="text-muted-foreground">Próxima revisão</dt><dd className="font-medium">{formatDate(item.nextRunAt)}</dd></div>
                <div><dt className="text-muted-foreground">Último contato registrado</dt><dd className="font-medium">{formatDate(item.lastSentAt)}</dd></div>
              </dl>
              {item.pausedReason ? <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Motivo: {item.pausedReason.replaceAll("_", " ")}</p> : null}
            </div>
            {item.status === "READY_FOR_REVIEW" ? <div className="flex flex-wrap gap-2 sm:w-44 sm:flex-col">
              <Button size="sm" variant="outline" asChild><Link href={"/inbox?conversation=" + encodeURIComponent(item.conversationId)}>Abrir atendimento</Link></Button>
              <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground"><Send className="mr-1 inline h-3.5 w-3.5" />Envie a mensagem pelo atendimento. A confirmação de envio agenda a próxima etapa.</p>
              <Button size="sm" variant="outline" onClick={() => void act(item, "PAUSE")} disabled={review.isPending}><Pause className="mr-1.5 h-4 w-4" />Pausar</Button>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void act(item, "CANCEL")} disabled={review.isPending}><X className="mr-1.5 h-4 w-4" />Cancelar</Button>
            </div> : null}
          </div></CardContent></Card>
        ))}</div>}
      </div>
    </main>
  );
}
