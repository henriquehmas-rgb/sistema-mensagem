"use client";

import { useState } from "react";
import { format } from "date-fns";
import { BookOpenText, BrainCircuit, Check, Link2, Loader2, Plus, Trash2, TrendingUp, Type, X } from "lucide-react";

import type { IngestStatus, SourceType } from "@sm/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateKnowledgeSource,
  useDeleteKnowledgeSource,
  useKnowledgeSources,
  useLearningCandidates,
  useLearningPatterns,
  useApproveLearningCandidate,
  useRejectLearningCandidate,
} from "@/lib/settings/hooks";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  IngestStatus,
  { label: string; variant: "secondary" | "warning" | "success" | "destructive" }
> = {
  PENDING: { label: "Pendente", variant: "secondary" },
  PROCESSING: { label: "Processando", variant: "warning" },
  READY: { label: "Pronta", variant: "success" },
  FAILED: { label: "Falhou", variant: "destructive" },
};

const TYPE_LABELS: Record<SourceType, string> = {
  PDF: "PDF",
  URL: "URL",
  TEXT: "Texto",
  TABLE: "Tabela",
};

type AddMode = "url" | "text";

export function KnowledgeSettings() {
  const role = useAuthStore((state) => state.user?.role);
  const canReview = role === "ADMIN" || role === "SUPERVISOR";
  const sourcesQuery = useKnowledgeSources();
  const candidatesQuery = useLearningCandidates(canReview);
  const patternsQuery = useLearningPatterns(canReview);
  const createSource = useCreateKnowledgeSource();
  const deleteSource = useDeleteKnowledgeSource();
  const approveCandidate = useApproveLearningCandidate();
  const rejectCandidate = useRejectLearningCandidate();

  const [mode, setMode] = useState<AddMode>("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [textType, setTextType] = useState<Extract<SourceType, "TEXT" | "TABLE">>("TEXT");

  const sources = sourcesQuery.data ?? [];
  const pendingCandidates = (candidatesQuery.data ?? []).filter(
    (candidate) => candidate.status === "PENDING",
  );

  const canSubmit =
    name.trim().length > 0 &&
    !createSource.isPending &&
    (mode === "url" ? url.trim().length > 0 : text.trim().length > 0);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    createSource.mutate(
      mode === "url"
        ? { type: "URL", name: name.trim(), contentUrl: url.trim() }
        : { type: textType, name: name.trim(), contentText: text.trim() },
      {
        onSuccess: () => {
          setName("");
          setUrl("");
          setText("");
        },
      },
    );
  };

  return (
    <div className="max-w-3xl space-y-4">
      {/* Card explicando o RAG */}
      <div className="flex items-start gap-3 rounded-xl border bg-primary/[0.04] p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <BookOpenText className="h-5 w-5 text-primary" />
        </span>
        <div className="text-xs leading-relaxed text-muted-foreground">
          <p className="text-sm font-semibold text-foreground">
            Como a IA usa esta base (RAG)
          </p>
          <p className="mt-1">
            Cada fonte é dividida em trechos e indexada com embeddings vetoriais.
            Ao responder um cliente, a IA busca os trechos mais relevantes e responde
            com base neles. Quando ainda existir uma lacuna real, ela consulta o responsável
            internamente e depois continua o atendimento com o cliente.
          </p>
        </div>
      </div>

      {canReview ? (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Padrões recentes de atendimento</h3>
          </div>
          {patternsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (patternsQuery.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Ainda não há recorrência suficiente para análise.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Assunto</TableHead><TableHead className="text-right">7 dias</TableHead><TableHead className="text-right">30 dias</TableHead><TableHead className="text-right">90 dias</TableHead><TableHead className="text-right">Tendência</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(patternsQuery.data ?? []).slice(0, 10).map((pattern) => (
                    <TableRow key={pattern.fingerprint}>
                      <TableCell><span className="line-clamp-2 max-w-md text-xs">{pattern.sample.split("\n")[0]}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{pattern.occurrences7d}</TableCell>
                      <TableCell className="text-right tabular-nums">{pattern.occurrences30d}</TableCell>
                      <TableCell className="text-right tabular-nums">{pattern.occurrences90d}</TableCell>
                      <TableCell className="text-right"><Badge variant={pattern.growthPercent !== null && pattern.growthPercent > 0 ? "warning" : "secondary"}>{pattern.growthPercent === null ? "—" : `${pattern.growthPercent > 0 ? "+" : ""}${pattern.growthPercent}%`}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : null}

      {canReview ? (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <BrainCircuit className="h-5 w-5 text-primary" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Aprendizado supervisionado</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Toda solução humana é sanitizada e registrada automaticamente. Apenas
                orientação técnica segura pode ter uso provisório; todos os aprendizados
                passam pela revisão humana semanal antes de se tornarem conteúdo definitivo.
              </p>
            </div>
          </div>

          {candidatesQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : pendingCandidates.length === 0 ? (
            <p className="rounded-lg bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
              Nenhuma solução humana aguardando revisão.
            </p>
          ) : (
            <div className="space-y-2">
              {pendingCandidates.map((candidate) => {
                const busy = approveCandidate.isPending || rejectCandidate.isPending;
                return (
                  <article key={candidate.id} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <Badge variant="secondary">{candidate.intent ?? "geral"}</Badge>
                      <Badge variant="outline">qualidade {Math.round(candidate.qualityScore * 100)}%</Badge>
                      {candidate.recurrenceCount > 1 ? (
                        <Badge variant="warning">{candidate.recurrenceCount} ocorrências</Badge>
                      ) : null}
                      {candidate.autoPublishedAt ? (
                        <Badge variant="warning">uso provisório</Badge>
                      ) : null}
                      <span className="text-[11px] text-muted-foreground">
                        {format(new Date(candidate.createdAt), "dd/MM/yyyy")}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{candidate.content}</p>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => rejectCandidate.mutate(candidate.id)}>
                        <X className="mr-1.5 h-3.5 w-3.5" /> Remover
                      </Button>
                      <Button size="sm" disabled={busy} onClick={() => approveCandidate.mutate(candidate.id)}>
                        <Check className="mr-1.5 h-3.5 w-3.5" /> Confirmar
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* Adicionar fonte */}
      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-dashed p-4">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode("url")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
              mode === "url"
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-accent",
            )}
          >
            <Link2 className="h-3.5 w-3.5" />
            Por URL
          </button>
          <button
            type="button"
            onClick={() => setMode("text")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors",
              mode === "text"
                ? "border-primary bg-primary/10 text-primary"
                : "border-input text-muted-foreground hover:bg-accent",
            )}
          >
            <Type className="h-3.5 w-3.5" />
            Colar texto
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="knowledge-name" className="text-xs">
              Nome da fonte *
            </Label>
            <Input
              id="knowledge-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: FAQ do produto"
              className="h-9"
              required
            />
          </div>
          {mode === "text" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo</Label>
              <Select
                value={textType}
                onValueChange={(value) =>
                  setTextType(value as Extract<SourceType, "TEXT" | "TABLE">)
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEXT">Texto</SelectItem>
                  <SelectItem value="TABLE">Tabela</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        {mode === "url" ? (
          <div className="space-y-1.5">
            <Label htmlFor="knowledge-url" className="text-xs">
              URL do conteúdo *
            </Label>
            <Input
              id="knowledge-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://exemplo.com/faq ou link de um PDF"
              className="h-9 font-mono text-xs"
              required
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="knowledge-text" className="text-xs">
              Conteúdo *
            </Label>
            <Textarea
              id="knowledge-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Cole aqui o conteúdo que a IA deve conhecer…"
              className="min-h-28 text-sm"
              required
            />
          </div>
        )}

        <Button type="submit" size="sm" className="gap-1.5" disabled={!canSubmit}>
          {createSource.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Adicionar fonte
        </Button>
      </form>

      {/* Lista de fontes */}
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fonte</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Trechos</TableHead>
              <TableHead>Adicionada em</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sourcesQuery.isLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-12" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="ml-auto h-4 w-8" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : sources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  Nenhuma fonte na base de conhecimento ainda.
                </TableCell>
              </TableRow>
            ) : (
              sources.map((source) => {
                const status = STATUS_META[source.status];
                const inFlight =
                  source.status === "PENDING" || source.status === "PROCESSING";
                return (
                  <TableRow key={source.id}>
                    <TableCell className="font-medium">{source.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {TYPE_LABELS[source.type]}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant} className="gap-1">
                        {inFlight ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : null}
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {source.chunkCount > 0 ? source.chunkCount : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {format(new Date(source.createdAt), "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        disabled={deleteSource.isPending}
                        onClick={() => deleteSource.mutate(source.id)}
                        aria-label={`Excluir fonte ${source.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
