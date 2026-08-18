"use client";

import { useMemo } from "react";
import { Check, ListFilter, UserX } from "lucide-react";

import type { ChannelType, PipelineStageDto, TagDto, UserDto } from "@sm/shared";

import { UserAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UNASSIGNED, type ConversationFilters } from "@/lib/inbox/types";
import { cn } from "@/lib/utils";

import { CHANNEL_LABELS, ChannelIcon } from "./channel-icons";

const ALL_VALUE = "__all__";
const CHANNEL_OPTIONS: ChannelType[] = ["WHATSAPP", "INSTAGRAM", "WEBCHAT"];

interface FiltersPopoverProps {
  filters: ConversationFilters;
  onChange: (patch: Partial<ConversationFilters>) => void;
  agents: UserDto[];
  stages: PipelineStageDto[];
  tags: TagDto[];
  /** Oculta o filtro de etapa (ex.: kanban — as colunas já são as etapas). */
  showStageFilter?: boolean;
}

export function countActiveFilters(filters: ConversationFilters): number {
  let count = 0;
  if (filters.channelType) count += 1;
  if (filters.assigneeId) count += 1;
  if (filters.stageId) count += 1;
  count += filters.tagIds.length;
  return count;
}

export function FiltersPopover({
  filters,
  onChange,
  agents,
  stages,
  tags,
  showStageFilter = true,
}: FiltersPopoverProps) {
  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);

  const toggleTag = (tagId: string): void => {
    onChange({
      tagIds: filters.tagIds.includes(tagId)
        ? filters.tagIds.filter((id) => id !== tagId)
        : [...filters.tagIds, tagId],
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative h-9 w-9 shrink-0"
          aria-label="Filtros"
        >
          <ListFilter className="h-4 w-4" />
          {activeCount > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="space-y-4 p-4">
          {/* Canal */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Canal</Label>
            <div className="grid grid-cols-4 gap-1.5">
              <button
                type="button"
                onClick={() => onChange({ channelType: null })}
                className={cn(
                  "flex h-9 items-center justify-center rounded-md border text-xs font-medium transition-colors",
                  filters.channelType === null
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground hover:bg-accent",
                )}
              >
                Todos
              </button>
              {CHANNEL_OPTIONS.map((channel) => (
                <button
                  key={channel}
                  type="button"
                  title={CHANNEL_LABELS[channel]}
                  aria-pressed={filters.channelType === channel}
                  onClick={() =>
                    onChange({
                      channelType: filters.channelType === channel ? null : channel,
                    })
                  }
                  className={cn(
                    "flex h-9 items-center justify-center rounded-md border transition-colors",
                    filters.channelType === channel
                      ? "border-primary bg-primary/10"
                      : "border-input hover:bg-accent",
                  )}
                >
                  <ChannelIcon type={channel} className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          {/* Responsável */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Responsável</Label>
            <Select
              value={filters.assigneeId ?? ALL_VALUE}
              onValueChange={(value) =>
                onChange({ assigneeId: value === ALL_VALUE ? null : value })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todos</SelectItem>
                <SelectItem value={UNASSIGNED}>
                  <span className="flex items-center gap-2">
                    <UserX className="h-3.5 w-3.5 text-muted-foreground" />
                    Não atribuídas
                  </span>
                </SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    <span className="flex items-center gap-2">
                      <UserAvatar
                        name={agent.name}
                        src={agent.avatarUrl}
                        className="h-5 w-5 text-[8px]"
                      />
                      {agent.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Etapa */}
          {showStageFilter ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Etapa</Label>
              <Select
                value={filters.stageId ?? ALL_VALUE}
                onValueChange={(value) =>
                  onChange({ stageId: value === ALL_VALUE ? null : value })
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>Todas</SelectItem>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        {stage.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* Tags (multi) */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tags</Label>
            <Command className="rounded-md border">
              <CommandInput placeholder="Buscar tag…" />
              <CommandList className="max-h-36">
                <CommandEmpty>Nenhuma tag encontrada.</CommandEmpty>
                <CommandGroup>
                  {tags.map((tag) => {
                    const selected = filters.tagIds.includes(tag.id);
                    return (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => toggleTag(tag.id)}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 truncate">{tag.name}</span>
                        {selected ? <Check className="h-4 w-4 text-primary" /> : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </div>

        <div className="flex justify-end border-t px-4 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={activeCount === 0}
            onClick={() =>
              onChange({ channelType: null, assigneeId: null, stageId: null, tagIds: [] })
            }
          >
            Limpar filtros
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
