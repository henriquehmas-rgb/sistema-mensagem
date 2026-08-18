"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, X } from "lucide-react";

import type {
  AutomationAction,
  AutomationActionType,
  AutomationCondition,
  AutomationConditionField,
  AutomationDto,
  AutomationTrigger,
  AutomationTriggerType,
  ChannelType,
  PipelineStageDto,
  TagDto,
  UserDto,
} from "@sm/shared";
import { ChannelTypes } from "@sm/shared";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAgents, useStages, useTags } from "@/lib/inbox/hooks";
import {
  useCreateAutomation,
  useUpdateAutomation,
} from "@/lib/settings/hooks";

import { CHANNEL_LABELS } from "../../inbox/components/channel-icons";

// ---------------------------------------------------------------------------
// Rótulos (compartilhados com a listagem)
// ---------------------------------------------------------------------------

export const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  "conversation.created": "Nova conversa",
  "message.received": "Mensagem recebida",
  "tag.added": "Tag adicionada",
  "conversation.moved": "Conversa movida de etapa",
  "no.reply": "Sem resposta há X min",
};

export function summarizeTrigger(trigger: AutomationTrigger): string {
  if (trigger.type === "no.reply") {
    return `Sem resposta há ${trigger.minutes ?? 15} min`;
  }
  return TRIGGER_LABELS[trigger.type] ?? trigger.type;
}

const CONDITION_FIELD_LABELS: Record<AutomationConditionField, string> = {
  channel: "Canal",
  tag: "Tag",
  stage: "Etapa",
  businessHours: "Horário comercial",
};

const ACTION_LABELS: Record<AutomationActionType, string> = {
  assign_agent: "Atribuir a agente",
  add_tag: "Adicionar tag",
  move_stage: "Mover para etapa",
  send_text: "Enviar mensagem de texto",
  send_template: "Enviar template",
  call_webhook: "Chamar webhook externo",
  notify_agents: "Notificar agentes",
};

const TRIGGER_OPTIONS = Object.keys(TRIGGER_LABELS) as AutomationTriggerType[];
const CONDITION_FIELD_OPTIONS = Object.keys(
  CONDITION_FIELD_LABELS,
) as AutomationConditionField[];
const ACTION_OPTIONS = Object.keys(ACTION_LABELS) as AutomationActionType[];

function defaultConditionValue(field: AutomationConditionField): string {
  switch (field) {
    case "channel":
      return "WHATSAPP";
    case "businessHours":
      return "inside";
    default:
      return "";
  }
}

function defaultActionFor(type: AutomationActionType): AutomationAction {
  switch (type) {
    case "assign_agent":
      return { type, agentId: "" };
    case "add_tag":
      return { type, tagId: "" };
    case "move_stage":
      return { type, stageId: "" };
    case "send_text":
      return { type, text: "" };
    case "send_template":
      return { type, templateName: "" };
    case "call_webhook":
      return { type, url: "" };
    case "notify_agents":
      return { type };
  }
}

function isActionComplete(action: AutomationAction): boolean {
  switch (action.type) {
    case "assign_agent":
      return action.agentId.length > 0;
    case "add_tag":
      return action.tagId.length > 0;
    case "move_stage":
      return action.stageId.length > 0;
    case "send_text":
      return action.text.trim().length > 0;
    case "send_template":
      return action.templateName.trim().length > 0;
    case "call_webhook":
      return action.url.trim().length > 0;
    case "notify_agents":
      return true;
  }
}

function isConditionComplete(condition: AutomationCondition): boolean {
  return condition.value.length > 0;
}

// ---------------------------------------------------------------------------
// Linha de condição
// ---------------------------------------------------------------------------

interface ConditionRowProps {
  condition: AutomationCondition;
  onChange: (condition: AutomationCondition) => void;
  onRemove: () => void;
  tags: TagDto[];
  stages: PipelineStageDto[];
}

function ConditionValueSelect({ condition, onChange, tags, stages }: Omit<ConditionRowProps, "onRemove">) {
  switch (condition.field) {
    case "channel":
      return (
        <Select
          value={condition.value.length > 0 ? condition.value : undefined}
          onValueChange={(value) => onChange({ ...condition, value })}
        >
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="Canal…" />
          </SelectTrigger>
          <SelectContent>
            {ChannelTypes.map((channel) => (
              <SelectItem key={channel} value={channel}>
                {CHANNEL_LABELS[channel as ChannelType]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "tag":
      return (
        <Select
          value={condition.value.length > 0 ? condition.value : undefined}
          onValueChange={(value) => onChange({ ...condition, value })}
        >
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="Tag…" />
          </SelectTrigger>
          <SelectContent>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "stage":
      return (
        <Select
          value={condition.value.length > 0 ? condition.value : undefined}
          onValueChange={(value) => onChange({ ...condition, value })}
        >
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="Etapa…" />
          </SelectTrigger>
          <SelectContent>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  {stage.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "businessHours":
      return (
        <Select
          value={condition.value.length > 0 ? condition.value : undefined}
          onValueChange={(value) => onChange({ ...condition, value })}
        >
          <SelectTrigger className="h-8 flex-1 text-xs">
            <SelectValue placeholder="Período…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inside">Dentro do horário</SelectItem>
            <SelectItem value="outside">Fora do horário</SelectItem>
          </SelectContent>
        </Select>
      );
  }
}

function ConditionRow({ condition, onChange, onRemove, tags, stages }: ConditionRowProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={condition.field}
        onValueChange={(value) => {
          const field = value as AutomationConditionField;
          onChange({ field, operator: condition.operator, value: defaultConditionValue(field) });
        }}
      >
        <SelectTrigger className="h-8 w-36 shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_FIELD_OPTIONS.map((field) => (
            <SelectItem key={field} value={field}>
              {CONDITION_FIELD_LABELS[field]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={condition.operator}
        onValueChange={(value) =>
          onChange({ ...condition, operator: value as AutomationCondition["operator"] })
        }
      >
        <SelectTrigger className="h-8 w-20 shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="is">é</SelectItem>
          <SelectItem value="is_not">não é</SelectItem>
        </SelectContent>
      </Select>

      <ConditionValueSelect
        condition={condition}
        onChange={onChange}
        tags={tags}
        stages={stages}
      />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label="Remover condição"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha de ação
// ---------------------------------------------------------------------------

interface ActionRowProps {
  action: AutomationAction;
  index: number;
  total: number;
  onChange: (action: AutomationAction) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  agents: UserDto[];
  tags: TagDto[];
  stages: PipelineStageDto[];
}

function ActionParams({
  action,
  onChange,
  agents,
  tags,
  stages,
}: Pick<ActionRowProps, "action" | "onChange" | "agents" | "tags" | "stages">) {
  switch (action.type) {
    case "assign_agent":
      return (
        <Select
          value={action.agentId.length > 0 ? action.agentId : undefined}
          onValueChange={(agentId) => onChange({ ...action, agentId })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Escolher agente…" />
          </SelectTrigger>
          <SelectContent>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "add_tag":
      return (
        <Select
          value={action.tagId.length > 0 ? action.tagId : undefined}
          onValueChange={(tagId) => onChange({ ...action, tagId })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Escolher tag…" />
          </SelectTrigger>
          <SelectContent>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "move_stage":
      return (
        <Select
          value={action.stageId.length > 0 ? action.stageId : undefined}
          onValueChange={(stageId) => onChange({ ...action, stageId })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Escolher etapa…" />
          </SelectTrigger>
          <SelectContent>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  {stage.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "send_text":
      return (
        <Textarea
          value={action.text}
          onChange={(event) => onChange({ ...action, text: event.target.value })}
          placeholder="Mensagem que será enviada ao contato…"
          className="min-h-16 text-xs"
        />
      );
    case "send_template":
      return (
        <Input
          value={action.templateName}
          onChange={(event) => onChange({ ...action, templateName: event.target.value })}
          placeholder="Nome do template aprovado na Meta"
          className="h-8 font-mono text-xs"
        />
      );
    case "call_webhook":
      return (
        <Input
          type="url"
          value={action.url}
          onChange={(event) => onChange({ ...action, url: event.target.value })}
          placeholder="https://exemplo.com/webhook"
          className="h-8 font-mono text-xs"
        />
      );
    case "notify_agents":
      return (
        <p className="text-[11px] text-muted-foreground">
          Todos os agentes online recebem uma notificação.
        </p>
      );
  }
}

function ActionRow({
  action,
  index,
  total,
  onChange,
  onMove,
  onRemove,
  agents,
  tags,
  stages,
}: ActionRowProps) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {ACTION_LABELS[action.type]}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label="Mover ação para cima"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          disabled={index === total - 1}
          onClick={() => onMove(1)}
          aria-label="Mover ação para baixo"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Remover ação"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ActionParams
        action={action}
        onChange={onChange}
        agents={agents}
        tags={tags}
        stages={stages}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Builder (dialog)
// ---------------------------------------------------------------------------

interface AutomationBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = criação; preenchido = edição. */
  automation: AutomationDto | null;
}

const ADD_ACTION_PLACEHOLDER = "__add__";

export function AutomationBuilder({ open, onOpenChange, automation }: AutomationBuilderProps) {
  const agentsQuery = useAgents();
  const tagsQuery = useTags();
  const stagesQuery = useStages();

  const createAutomation = useCreateAutomation();
  const updateAutomation = useUpdateAutomation();

  const [name, setName] = useState("");
  const [triggerType, setTriggerType] =
    useState<AutomationTriggerType>("conversation.created");
  const [triggerMinutes, setTriggerMinutes] = useState(15);
  const [conditions, setConditions] = useState<AutomationCondition[]>([]);
  const [actions, setActions] = useState<AutomationAction[]>([]);

  // Sincroniza o estado ao abrir (criação limpa / edição carrega).
  useEffect(() => {
    if (!open) return;
    if (automation) {
      setName(automation.name);
      setTriggerType(automation.trigger.type);
      setTriggerMinutes(automation.trigger.minutes ?? 15);
      setConditions(automation.conditions);
      setActions(automation.actions);
    } else {
      setName("");
      setTriggerType("conversation.created");
      setTriggerMinutes(15);
      setConditions([]);
      setActions([]);
    }
  }, [open, automation]);

  const isSaving = createAutomation.isPending || updateAutomation.isPending;
  const canSave =
    name.trim().length > 0 &&
    actions.length > 0 &&
    actions.every(isActionComplete) &&
    conditions.every(isConditionComplete) &&
    (triggerType !== "no.reply" || triggerMinutes > 0) &&
    !isSaving;

  const handleSave = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!canSave) return;

    const trigger: AutomationTrigger = {
      type: triggerType,
      ...(triggerType === "no.reply" ? { minutes: triggerMinutes } : {}),
    };
    const payload = { name: name.trim(), trigger, conditions, actions };

    if (automation) {
      updateAutomation.mutate(
        { id: automation.id, input: payload },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createAutomation.mutate(
        { ...payload, enabled: true },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  const updateCondition = (index: number, condition: AutomationCondition): void => {
    setConditions((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? condition : item)),
    );
  };

  const updateAction = (index: number, action: AutomationAction): void => {
    setActions((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? action : item)),
    );
  };

  const moveAction = (index: number, direction: -1 | 1): void => {
    setActions((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const a = next[index];
      const b = next[target];
      if (a === undefined || b === undefined) return current;
      next[index] = b;
      next[target] = a;
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{automation ? "Editar automação" : "Nova automação"}</DialogTitle>
          <DialogDescription>
            Quando o gatilho disparar e as condições forem verdadeiras, as ações
            executam em ordem.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-5">
          {/* Nome */}
          <div className="space-y-1.5">
            <Label htmlFor="automation-name">Nome *</Label>
            <Input
              id="automation-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Boas-vindas fora do horário"
              autoFocus
              required
            />
          </div>

          {/* Gatilho */}
          <div className="space-y-1.5">
            <Label>Gatilho *</Label>
            <div className="flex items-center gap-2">
              <Select
                value={triggerType}
                onValueChange={(value) => setTriggerType(value as AutomationTriggerType)}
              >
                <SelectTrigger className="h-9 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map((type) => (
                    <SelectItem key={type} value={type}>
                      {TRIGGER_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {triggerType === "no.reply" ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    value={triggerMinutes}
                    onChange={(event) =>
                      setTriggerMinutes(Math.max(1, Number(event.target.value) || 1))
                    }
                    aria-label="Minutos sem resposta"
                    className="h-9 w-20 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Condições */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Condições</Label>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Todas devem ser verdadeiras (E)
              </span>
            </div>
            {conditions.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                Sem condições — a automação executa sempre que o gatilho disparar.
              </p>
            ) : (
              <div className="space-y-1.5">
                {conditions.map((condition, index) => (
                  <ConditionRow
                    // eslint-disable-next-line react/no-array-index-key -- linhas sem id próprio
                    key={index}
                    condition={condition}
                    onChange={(next) => updateCondition(index, next)}
                    onRemove={() =>
                      setConditions((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    tags={tagsQuery.data ?? []}
                    stages={stagesQuery.data ?? []}
                  />
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                setConditions((current) => [
                  ...current,
                  { field: "channel", operator: "is", value: "WHATSAPP" },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar condição
            </Button>
          </div>

          {/* Ações */}
          <div className="space-y-2">
            <Label>Ações * (executam em ordem)</Label>
            {actions.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                Adicione pelo menos uma ação.
              </p>
            ) : (
              <div className="space-y-2">
                {actions.map((action, index) => (
                  <ActionRow
                    // eslint-disable-next-line react/no-array-index-key -- linhas sem id próprio
                    key={index}
                    action={action}
                    index={index}
                    total={actions.length}
                    onChange={(next) => updateAction(index, next)}
                    onMove={(direction) => moveAction(index, direction)}
                    onRemove={() =>
                      setActions((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    agents={agentsQuery.data ?? []}
                    tags={tagsQuery.data ?? []}
                    stages={stagesQuery.data ?? []}
                  />
                ))}
              </div>
            )}
            <Select
              value={ADD_ACTION_PLACEHOLDER}
              onValueChange={(value) => {
                if (value === ADD_ACTION_PLACEHOLDER) return;
                setActions((current) => [
                  ...current,
                  defaultActionFor(value as AutomationActionType),
                ]);
              }}
            >
              <SelectTrigger className="h-9 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ADD_ACTION_PLACEHOLDER} className="hidden">
                  + Adicionar ação
                </SelectItem>
                {ACTION_OPTIONS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {ACTION_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSave}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {automation ? "Salvar alterações" : "Criar automação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
