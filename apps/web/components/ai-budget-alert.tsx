"use client";

import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAcknowledgeAiBudgetAlert, useAiBudget } from "@/lib/ai-budget/hooks";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function AiBudgetAlert() {
  const role = useAuthStore((state) => state.user?.role);
  const allowed = role === "ADMIN" || role === "SUPERVISOR";
  const query = useAiBudget(allowed);
  const acknowledge = useAcknowledgeAiBudgetAlert();
  const alert = query.data?.alerts.find((item) => !item.acknowledgedAt);
  if (!allowed || !alert || !query.data) return null;

  const critical = alert.threshold >= 100;
  return (
    <div
      role="alert"
      className={cn(
        "shrink-0 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm",
        critical ? "border-destructive/30 bg-destructive/10" : "border-amber-500/30 bg-amber-500/10",
      )}
    >
      <AlertTriangle className={cn("h-4 w-4", critical ? "text-destructive" : "text-amber-600")} />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">Atenção ao consumo de IA: {alert.threshold}%.</span>{" "}
        <span className="text-muted-foreground">
          Estimativa de {money.format(query.data.estimatedBrl)} em {money.format(query.data.budgetBrl)} neste mês.
          O atendimento continua ativo; verifique a causa do aumento.
        </span>
      </div>
      <Button
        size="sm" variant="outline" disabled={acknowledge.isPending}
        onClick={() => acknowledge.mutate(alert.id)}
      >
        <Check className="mr-1 h-3.5 w-3.5" /> Marcar como visto
      </Button>
    </div>
  );
}
