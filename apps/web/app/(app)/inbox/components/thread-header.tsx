"use client";

import { Check, PanelRightClose, PanelRightOpen, RotateCcw, Sparkles } from "lucide-react";

import type { ConversationDto } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgents, useStages, useUpdateConversation } from "@/lib/inbox/hooks";
import { useInboxStore } from "@/lib/stores/inbox";
import { cn } from "@/lib/utils";

import { CHANNEL_LABELS, ChannelIcon } from "./channel-icons";

const NONE_VALUE = "__none__";

interface ThreadHeaderProps {
  conversation: ConversationDto;
}

export function ThreadHeader({ conversation }: ThreadHeaderProps) {
  const agentsQuery = useAgents();
  const stagesQuery = useStages();
  const updateConversation = useUpdateConversation(conversation.id);

  const crmOpen = useInboxStore((state) => state.crmOpen);
  const toggleCrm = useInboxStore((state) => state.toggleCrm);

  const agents = agentsQuery.data ?? [];
  const stages = stagesQuery.data ?? [];
  const isResolved = conversation.status === "RESOLVED";
  const currentStage = stages.find((stage) => stage.id === conversation.stageId);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card/60 px-4">
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
        {/* Responsável */}
        <Select
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
        </Select>

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
          onClick={() =>
            updateConversation.mutate({ status: isResolved ? "OPEN" : "RESOLVED" })
          }
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
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={toggleCrm}
              aria-label={crmOpen ? "Fechar painel do contato" : "Abrir painel do contato"}
            >
              {crmOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {crmOpen ? "Fechar painel do contato" : "Abrir painel do contato"}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
