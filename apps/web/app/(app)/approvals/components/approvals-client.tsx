"use client";

import { useState } from "react";
import { Check, Clock3, FlaskConical, ShieldCheck, X } from "lucide-react";

import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type {
  OperationalActionProposalDto,
  OperationalActionRequestStatus,
} from "@/lib/operational-actions/api";
import {
  useOperationalActionProposals,
  useHomologationPlan,
  useReviewOperationalActionProposal,
} from "@/lib/operational-actions/hooks";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ value: OperationalActionRequestStatus; label: string }> = [
  { value: "PENDING_REVIEW", label: "Pendentes" },
  { value: "APPROVED", label: "Aprovadas" },
  { value: "REJECTED", label: "Rejeitadas" },
];

const ACTION_LABELS = {
  request_ticket: "Abrir chamado",
  request_service_order: "Solicitar ordem de serviço",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short", timeStyle: "short",
  }).format(new Date(value));
}

export function ApprovalsClient() {
  const user = useAuthStore((state) => state.user);
  const [status, setStatus] = useState<OperationalActionRequestStatus>("PENDING_REVIEW");
  const [review, setReview] = useState<{
    proposal: OperationalActionProposalDto;
    decision: "APPROVED" | "REJECTED";
  } | null>(null);
  const [note, setNote] = useState("");
  const proposals = useOperationalActionProposals(status);
  const homologation = useHomologationPlan();
  const reviewMutation = useReviewOperationalActionProposal();
  const allowed = user?.role === "ADMIN" || user?.role === "SUPERVISOR";

  const submitReview = async () => {
    if (!review) return;
    await reviewMutation.mutateAsync({
      id: review.proposal.id, decision: review.decision, note,
    });
    setReview(null);
    setNote("");
  };

  if (!allowed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Esta área é exclusiva para responsáveis pela revisão.
      </div>
    );
  }

  return (
    <main className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Aprovações operacionais</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Revise propostas do Omni. Aprovar não executa nenhuma ação no IXC.
          </p>
        </header>

        <Card className="border-primary/20">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Plano de homologação</h2>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary">SHADOW</Badge>
                <Badge variant="outline">Sem escrita externa</Badge>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Cenários preparados para validar decisões antes de habilitar o primeiro disparo real.
            </p>
            {homologation.isError ? (
              <QueryError error={homologation.error} onRetry={() => void homologation.refetch()} retrying={homologation.isFetching} />
            ) : homologation.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {homologation.data?.scenarios.map((scenario) => (
                  <div key={scenario.id} className="rounded-lg border bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{scenario.title}</p>
                      <Badge variant={scenario.expectedState === "READY_TO_TRIGGER" ? "success" : scenario.expectedState === "BLOCKED" ? "destructive" : "warning"}>
                        {scenario.expectedState}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{scenario.expectedBehavior}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar propostas">
          {FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={status === filter.value ? "default" : "outline"}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        {proposals.isError ? (
          <QueryError error={proposals.error} onRetry={() => void proposals.refetch()} retrying={proposals.isFetching} />
        ) : proposals.isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-44 w-full" />)}</div>
        ) : proposals.data?.length === 0 ? (
          <Card><CardContent className="flex min-h-48 flex-col items-center justify-center text-center">
            <Clock3 className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="font-medium">Nenhuma proposta nesta lista</p>
            <p className="mt-1 text-sm text-muted-foreground">Quando o Omni solicitar uma revisão, ela aparecerá aqui.</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {proposals.data?.map((proposal) => {
              const ownProposal = proposal.requestedById === user?.id;
              return (
                <Card key={proposal.id}>
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={proposal.status === "APPROVED" ? "success" : proposal.status === "REJECTED" ? "destructive" : "warning"}>
                            {FILTERS.find((item) => item.value === proposal.status)?.label ?? proposal.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{formatDate(proposal.createdAt)}</span>
                        </div>
                        <div>
                          <h2 className="font-semibold">{ACTION_LABELS[proposal.requestedAction]}</h2>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {proposal.conversation.caseSummary || proposal.requestPayload.intent || "Sem resumo disponível."}
                          </p>
                        </div>
                        <dl className="grid gap-2 text-xs sm:grid-cols-2">
                          <div><dt className="text-muted-foreground">Protocolo da conversa</dt><dd className="font-medium">{proposal.conversation.protocol}</dd></div>
                          <div><dt className="text-muted-foreground">Regra utilizada</dt><dd className="font-medium">{proposal.skill.name} · v{proposal.skill.version}</dd></div>
                          <div><dt className="text-muted-foreground">Executor previsto</dt><dd className="font-medium">IXC direto</dd></div>
                          <div><dt className="text-muted-foreground">Diagnóstico técnico</dt><dd className="font-medium">{proposal.requestPayload.networkDiagnosis || "Não informado"}</dd></div>
                          <div><dt className="text-muted-foreground">Mapeamento controlado</dt><dd className="font-medium">{proposal.requestPayload.mappingKey} · v{proposal.requestPayload.mappingVersion ?? "?"}</dd></div>
                          <div><dt className="text-muted-foreground">Estado do mapeamento</dt><dd className="font-medium">{proposal.requestPayload.mappingStatus ?? "Não registrado"}</dd></div>
                          <div><dt className="text-muted-foreground">Origem da ocorrência</dt><dd className="font-medium">{proposal.requestPayload.occurrenceSource ?? "Não registrada"}</dd></div>
                          <div><dt className="text-muted-foreground">Controle de duplicidade</dt><dd className="font-medium">{proposal.requestPayload.duplicateStrategy ?? "Não registrado"}</dd></div>
                        </dl>
                        {proposal.reviewNote ? <p className="rounded-md bg-muted px-3 py-2 text-sm">{proposal.reviewNote}</p> : null}
                      </div>
                      {proposal.status === "PENDING_REVIEW" ? (
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" variant="outline" disabled={ownProposal} onClick={() => { setReview({ proposal, decision: "REJECTED" }); setNote(""); }}>
                            <X className="mr-1.5 h-4 w-4" />Rejeitar
                          </Button>
                          <Button size="sm" disabled={ownProposal} onClick={() => { setReview({ proposal, decision: "APPROVED" }); setNote(""); }}>
                            <Check className="mr-1.5 h-4 w-4" />Aprovar
                          </Button>
                          {ownProposal ? <span className="sr-only">Outra pessoa responsável deve revisar.</span> : null}
                        </div>
                      ) : null}
                    </div>
                    {ownProposal && proposal.status === "PENDING_REVIEW" ? (
                      <p className="mt-3 text-xs text-warning">Você solicitou esta ação. Outro responsável precisa revisá-la.</p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={Boolean(review)} onOpenChange={(open) => { if (!open) setReview(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{review?.decision === "APPROVED" ? "Aprovar proposta?" : "Rejeitar proposta?"}</DialogTitle>
            <DialogDescription>
              {review?.decision === "APPROVED"
                ? "Isso registra a aprovação interna, mas não executa a ação no IXC."
                : "Explique brevemente a razão para orientar a próxima análise."}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="Observação (opcional)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)}>Cancelar</Button>
            <Button
              variant={review?.decision === "REJECTED" ? "destructive" : "default"}
              disabled={reviewMutation.isPending}
              onClick={() => void submitReview()}
              className={cn(reviewMutation.isPending && "opacity-70")}
            >
              {reviewMutation.isPending ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
