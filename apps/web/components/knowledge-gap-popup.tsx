"use client";

import { useEffect, useState } from "react";
import { CircleHelp, Loader2, MessageSquareReply, Minimize2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAnswerKnowledgeGap, useDismissKnowledgeGap, useKnowledgeGaps } from "@/lib/settings/hooks";
import { useAuthStore } from "@/lib/stores/auth";

export function KnowledgeGapPopup() {
  const role = useAuthStore((state) => state.user?.role);
  const canAnswer = role === "ADMIN" || role === "SUPERVISOR" || role === "AGENT";
  const canDismiss = role === "ADMIN" || role === "SUPERVISOR";
  const gaps = useKnowledgeGaps("PENDING", canAnswer);
  const answerGap = useAnswerKnowledgeGap();
  const dismissGap = useDismissKnowledgeGap();
  const [minimized, setMinimized] = useState(false);
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<"answer" | "dismiss">("answer");
  const current = gaps.data?.[0];

  useEffect(() => {
    if (!current?.id) return;
    setAnswer("");
    setMode("answer");
    setMinimized(false);
  }, [current?.id]);

  if (!canAnswer || !current) return null;
  const count = gaps.data?.length ?? 0;

  if (minimized) {
    return (
      <Button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-50 gap-2 rounded-full shadow-soft-lg"
        aria-label={`Abrir ${count} dúvidas pendentes da IA`}
      >
        <CircleHelp className="h-4 w-4" />
        Dúvidas da IA
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1 text-[10px] font-semibold text-foreground">
          {count > 99 ? "99+" : count}
        </span>
      </Button>
    );
  }

  return (
    <Card className="fixed bottom-4 right-4 z-50 w-[min(420px,calc(100vw-2rem))] border-primary/30 shadow-soft-lg">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleHelp className="h-4 w-4 text-primary" />
              A IA precisa de orientação
            </CardTitle>
            <CardDescription className="mt-1">
              {mode === "answer"
                ? "Sua resposta é interna. A IA continuará a conversa com o cliente."
                : "O descarte é interno, exige justificativa e não envia mensagem ao cliente."}
            </CardDescription>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => setMinimized(true)} aria-label="Minimizar dúvida">
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{current.department?.name ?? "Atendimento geral"}</Badge>
          <span className="text-xs text-muted-foreground">Protocolo {current.conversation.protocol}</span>
          {count > 1 ? <Badge variant="outline">{count} pendentes</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg bg-muted/60 p-3">
          <p className="text-sm font-medium">{current.question}</p>
          {current.conversation.caseSummary ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{current.conversation.caseSummary}</p>
          ) : null}
        </div>
        <Textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={mode === "answer" ? "Oriente a IA sobre como prosseguir..." : "Explique por que esta dúvida pode ser descartada..."}
          maxLength={4000}
          autoFocus
        />
        <Button
          type="button"
          className="w-full"
          onClick={() => mode === "answer"
            ? answerGap.mutate({ id: current.id, answer })
            : dismissGap.mutate({ id: current.id, note: answer })}
          disabled={answer.trim().length < (mode === "answer" ? 2 : 8) || answerGap.isPending || dismissGap.isPending}
        >
          {answerGap.isPending || dismissGap.isPending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : mode === "answer" ? <MessageSquareReply className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {mode === "answer" ? "Orientar a IA" : "Confirmar descarte"}
        </Button>
        {canDismiss ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => { setAnswer(""); setMode((currentMode) => currentMode === "answer" ? "dismiss" : "answer"); }}
            disabled={answerGap.isPending || dismissGap.isPending}
          >
            {mode === "answer" ? "Descartar esta dúvida" : "Voltar para orientação"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
