"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, Workflow, Zap } from "lucide-react";

import type { AutomationDto } from "@sm/shared";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useAutomations,
  useDeleteAutomation,
  useUpdateAutomation,
} from "@/lib/settings/hooks";

import { AutomationBuilder, summarizeTrigger } from "./automation-builder";

function AutomationRow({
  automation,
  onEdit,
}: {
  automation: AutomationDto;
  onEdit: (automation: AutomationDto) => void;
}) {
  const updateAutomation = useUpdateAutomation();
  const deleteAutomation = useDeleteAutomation();

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Workflow className="h-5 w-5 text-primary" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{automation.name}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Zap className="h-3 w-3" />
          {summarizeTrigger(automation.trigger)}
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {automation.actions.length}{" "}
            {automation.actions.length === 1 ? "ação" : "ações"}
          </span>
        </p>
      </div>
      <span
        className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground"
        title="Execuções"
      >
        {automation.runCount}× executada
      </span>
      <Switch
        checked={automation.enabled}
        disabled={updateAutomation.isPending}
        onCheckedChange={(enabled) =>
          updateAutomation.mutate({ id: automation.id, input: { enabled } })
        }
        aria-label={
          automation.enabled
            ? `Desativar automação ${automation.name}`
            : `Ativar automação ${automation.name}`
        }
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground"
        onClick={() => onEdit(automation)}
        aria-label={`Editar automação ${automation.name}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        disabled={deleteAutomation.isPending}
        onClick={() => deleteAutomation.mutate(automation.id)}
        aria-label={`Excluir automação ${automation.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function AutomationsSettings() {
  const automationsQuery = useAutomations();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationDto | null>(null);

  const automations = automationsQuery.data ?? [];

  const openCreate = (): void => {
    setEditing(null);
    setBuilderOpen(true);
  };

  const openEdit = (automation: AutomationDto): void => {
    setEditing(automation);
    setBuilderOpen(true);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Automações</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Gatilhos + condições + ações — deixe o fluxo de atendimento no piloto
            automático.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nova automação
        </Button>
      </div>

      {automationsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-[76px] w-full rounded-xl" />
          ))}
        </div>
      ) : automations.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-10 text-center">
          <Workflow className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm font-medium">Nenhuma automação ainda</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Crie a primeira automação — por exemplo, responder automaticamente fora
            do horário comercial.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              onEdit={openEdit}
            />
          ))}
        </div>
      )}

      <AutomationBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        automation={editing}
      />
    </div>
  );
}
