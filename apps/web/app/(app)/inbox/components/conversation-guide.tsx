"use client";

import { Bot, Building2, CircleCheck, Route, UserRound } from "lucide-react";

import type { ConversationDto } from "@sm/shared";

const INTENT_LABELS: Record<string, string> = {
  general_support: "Atendimento geral",
  technical_support: "Problema técnico",
  billing: "Financeiro ou cobrança",
  sales: "Interesse comercial",
  cancellation: "Cancelamento ou retenção",
};

function nextActionOf(conversation: ConversationDto): {
  label: string;
  detail: string;
  icon: typeof Route;
} {
  if (conversation.status === "RESOLVED") {
    return { label: "Atendimento concluído", detail: "Reabra somente se o cliente retornar.", icon: CircleCheck };
  }
  if (!conversation.assigneeId && !conversation.aiEnabled) {
    return { label: "Assumir atendimento", detail: "Use o botão acima para continuar com segurança.", icon: UserRound };
  }
  if (conversation.aiEnabled) {
    return { label: "Acompanhar resposta da IA", detail: "Assuma a conversa se precisar intervir.", icon: Bot };
  }
  return { label: "Responder ao cliente", detail: "Use o campo de mensagem logo abaixo.", icon: UserRound };
}

export function ConversationGuide({ conversation }: { conversation: ConversationDto }) {
  const nextAction = nextActionOf(conversation);
  const NextIcon = nextAction.icon;
  const confidence = conversation.triageConfidence === null
    ? null
    : Math.round(conversation.triageConfidence * 100);

  return (
    <section aria-label="Resumo do atendimento" className="grid shrink-0 gap-px border-b bg-border sm:grid-cols-3">
      <div className="flex min-w-0 items-start gap-2.5 bg-background px-4 py-2.5">
        <Route className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">O que o cliente precisa</p>
          <p className="line-clamp-2 text-xs font-semibold" title={conversation.caseSummary ?? undefined}>{conversation.caseSummary ?? "Ainda não identificado"}</p>
          <p className="text-[10px] text-muted-foreground">{conversation.lastIntent ? `${INTENT_LABELS[conversation.lastIntent] ?? conversation.lastIntent}${confidence === null ? "" : ` · ${confidence}%`}` : "O resumo será criado a partir do histórico."}</p>
        </div>
      </div>
      <div className="flex min-w-0 items-start gap-2.5 bg-background px-4 py-2.5">
        <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Para onde foi encaminhado</p>
          <p className="truncate text-xs font-semibold">{conversation.department?.name ?? "Atendimento geral"}</p>
          <p className="text-[10px] text-muted-foreground">Protocolo {conversation.protocol}</p>
        </div>
      </div>
      <div className="flex min-w-0 items-start gap-2.5 bg-primary/[0.06] px-4 py-2.5">
        <NextIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Próxima ação</p>
          <p className="truncate text-xs font-semibold">{nextAction.label}</p>
          <p className="text-[10px] text-muted-foreground">{nextAction.detail}</p>
        </div>
      </div>
    </section>
  );
}
