"use client";

import { useState } from "react";
import { Check, Loader2, PanelRightClose, PanelRightOpen, RotateCcw, Sparkles, UserPlus } from "lucide-react";

import type { ConversationDto } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useAgents,
  useClaimConversation,
  useResolutionReasons,
  useStages,
  useUpdateConversation,
} from "@/lib/inbox/hooks";
import { useInboxStore } from "@/lib/stores/inbox";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

import { CHANNEL_LABELS, ChannelIcon } from "./channel-icons";

const NONE_VALUE = "__none__";

interface ThreadHeaderProps {
  conversation: ConversationDto;
}

export function ThreadHeader({ conversation }: ThreadHeaderProps) {
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [resolutionReasonId, setResolutionReasonId] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const agentsQuery = useAgents();
  const stagesQuery = useStages();
  const resolutionReasonsQuery = useResolutionReasons();
  const updateConversation = useUpdateConversation(conversation.id);
  const claimConversation = useClaimConversation(conversation.id);
  const currentUser = useAuthStore((state) => state.user);

  const crmOpen = useInboxStore((state) => state.crmOpen);
  const toggleCrm = useInboxStore((state) => state.toggleCrm);

  const agents = agentsQuery.data ?? [];
  const stages = stagesQuery.data ?? [];
  const resolutionReasons = resolutionReasonsQuery.data ?? [];
  const isResolved = conversation.status === "RESOLVED";
  const currentStage = stages.find((stage) => stage.id === conversation.stageId);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 overflow-x-auto border-b bg-card/60 px-4">
      {/* Contato + canal */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <UserAvatar
          name={conversation.contact.name}
          src={conversation.contact.avatarUrl}
          className="h-9 w-9 shrink-0"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {conversation.contact.name}
          </p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <ChannelIcon type={conversation.channelType} className="h-3 w-3" />
            {CHANNEL_LABELS[conversation.channelType]}
            {conversation.contact.phone ? (
              <span className="truncate">· {conversation.contact.phone}</span>
            ) : null}
          </p>
        </div>
      </div>

      {/* Ações */}
      <div className="flex shrink-0 items-center gap-2">
        {!conversation.assigneeId && !isResolved ? (
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={claimConversation.isPending}
            onClick={() => claimConversation.mutate()}
          >
            {claimConversation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Assumir atendimento
          </Button>
        ) : null}
        {/* Responsável */}
        {currentUser?.role !== "AGENT" ? <Select
          value={conversation.assigneeId ?? NONE_VALUE}
          onValueChange={(value) =>
            updateConversation.mutate({
              assigneeId: value === NONE_VALUE ? null : value,
            })
          }
        >
          <SelectTrigger
            className="h-8 w-[150px] text-xs"
            aria-label="Responsável pela conversa"
          >
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>
              <span className="text-muted-foreground">Não atribuído</span>
            </SelectItem>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                <span className="flex items-center gap-2">
                  <UserAvatar
                    name={agent.name}
                    src={agent.avatarUrl}
                    className="h-5 w-5 text-[8px]"
                  />
                  <span className="truncate">{agent.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select> : conversation.assignee ? (
          <span className="flex h-8 items-center gap-2 rounded-md border px-2 text-xs">
            <UserAvatar name={conversation.assignee.name} src={conversation.assignee.avatarUrl} className="h-5 w-5 text-[8px]" />
            {conversation.assignee.name}
          </span>
        ) : null}

        {/* Etapa (colorida) */}
        <Select
          value={conversation.stageId ?? NONE_VALUE}
          onValueChange={(value) =>
            updateConversation.mutate({ stageId: value === NONE_VALUE ? null : value })
          }
        >
          <SelectTrigger
            className="h-8 w-[140px] text-xs"
            aria-label="Etapa do funil"
            style={
              currentStage
                ? {
                    borderColor: `${currentStage.color}66`,
                    backgroundColor: `${currentStage.color}14`,
                  }
                : undefined
            }
          >
            <SelectValue placeholder="Etapa" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>
              <span className="text-muted-foreground">Sem etapa</span>
            </SelectItem>
            {stages.map((stage) => (
              <SelectItem key={stage.id} value={stage.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="truncate">{stage.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Switch IA */}
        <Tooltip>
          <TooltipTrigger asChild>
            <label
              className={cn(
                "flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2",
                conversation.aiEnabled
                  ? "border-primary/40 bg-primary/10"
                  : "border-input",
              )}
            >
              <Sparkles
                className={cn(
                  "h-3.5 w-3.5",
                  conversation.aiEnabled ? "text-primary" : "text-muted-foreground",
                )}
              />
              <Switch
                checked={conversation.aiEnabled}
                onCheckedChange={(checked) =>
                  updateConversation.mutate({ aiEnabled: checked })
                }
                aria-label="Respostas automáticas por IA"
                className="scale-90"
              />
              <span className="whitespace-nowrap text-[11px] font-medium">
                {conversation.aiEnabled ? "IA ativa" : "IA pausada"}
              </span>
            </label>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-56 text-center">
            {conversation.aiEnabled
              ? "IA ativa: responde automaticamente com base no conhecimento da empresa. Desative para assumir a conversa."
              : "IA desativada: apenas atendentes humanos respondem nesta conversa."}
          </TooltipContent>
        </Tooltip>

        {/* Resolver / Reabrir */}
        <Button
          variant={isResolved ? "outline" : "default"}
          size="sm"
          className="h-8"
          disabled={updateConversation.isPending}
          onClick={() => {
            if (isResolved) {
              updateConversation.mutate({ status: "OPEN" });
            } else {
              setResolutionOpen(true);
            }
          }}
        >
          {isResolved ? (
            <>
              <RotateCcw className="h-3.5 w-3.5" />
              Reabrir
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" />
              Resolver
            </>
          )}
        </Button>

        {/* Painel CRM */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-muted-foreground"
              onClick={toggleCrm}
              aria-label={crmOpen ? "Fechar painel do contato" : "Abrir painel do contato"}
            >
              {crmOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
              Detalhes
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {crmOpen ? "Fechar painel do contato" : "Abrir painel do contato"}
          </TooltipContent>
        </Tooltip>
      </div>

      <Dialog open={resolutionOpen} onOpenChange={setResolutionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encerrar atendimento</DialogTitle>
            <DialogDescription>
              O motivo ficará registrado no protocolo {conversation.protocol} para auditoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="resolution-reason">
                Motivo do encerramento
              </label>
              <Select value={resolutionReasonId} onValueChange={setResolutionReasonId}>
                <SelectTrigger id="resolution-reason">
                  <SelectValue placeholder="Selecione um motivo" />
                </SelectTrigger>
                <SelectContent>
                  {resolutionReasons.map((reason) => (
                    <SelectItem key={reason.id} value={reason.id}>
                      {reason.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="resolution-note">
                Observação (opcional)
              </label>
              <Textarea
                id="resolution-note"
                value={resolutionNote}
                maxLength={1000}
                onChange={(event) => setResolutionNote(event.target.value)}
                placeholder="Registre informações úteis para consultas futuras."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolutionOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!resolutionReasonId || updateConversation.isPending}
              onClick={() =>
                updateConversation.mutate(
                  {
                    status: "RESOLVED",
                    resolutionReasonId,
                    resolutionNote: resolutionNote.trim() || null,
                  },
                  {
                    onSuccess: () => {
                      setResolutionOpen(false);
                      setResolutionReasonId("");
                      setResolutionNote("");
                    },
                  },
                )
              }
            >
              Confirmar encerramento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
