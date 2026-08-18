"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, HandHelping, Loader2, Plus, Trash2 } from "lucide-react";

import type { PipelineStageDto } from "@sm/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useStages } from "@/lib/inbox/hooks";
import {
  useCreateStage,
  useDeleteStage,
  useReorderStages,
  useUpdateStage,
} from "@/lib/settings/hooks";
import { cn } from "@/lib/utils";

import { COLOR_PALETTE, ColorPicker } from "./color-picker";

// ---------------------------------------------------------------------------
// Nome com edição inline
// ---------------------------------------------------------------------------

function InlineNameEdit({
  name,
  onSave,
}: {
  name: string;
  onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  const commit = (): void => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed.length > 0 && trimmed !== name) {
      onSave(trimmed);
    } else {
      setDraft(name);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm font-medium hover:bg-accent"
        title="Clique para renomear"
      >
        {name}
      </button>
    );
  }

  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          setDraft(name);
          setEditing(false);
        }
      }}
      autoFocus
      aria-label="Nome da etapa"
      className="h-7 flex-1 text-sm"
    />
  );
}

// ---------------------------------------------------------------------------
// Linha sortable
// ---------------------------------------------------------------------------

function StageRow({ stage }: { stage: PipelineStageDto }) {
  const updateStage = useUpdateStage();
  const deleteStage = useDeleteStage();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex list-none items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5",
        stage.isHumanHandoff && "border-warning/50 bg-warning/[0.05]",
        isDragging && "z-10 opacity-80 shadow-soft-lg",
      )}
    >
      <button
        type="button"
        aria-label={`Reordenar etapa ${stage.name}`}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <ColorPicker
        value={stage.color}
        onChange={(color) => updateStage.mutate({ id: stage.id, input: { color } })}
        label={`Cor da etapa ${stage.name}`}
      />

      <InlineNameEdit
        name={stage.name}
        onSave={(name) => updateStage.mutate({ id: stage.id, input: { name } })}
      />

      {stage.isDefault ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          Padrão
        </span>
      ) : null}

      <Tooltip>
        <TooltipTrigger asChild>
          <label className="flex cursor-pointer items-center gap-1.5">
            <HandHelping
              className={cn(
                "h-4 w-4",
                stage.isHumanHandoff ? "text-warning" : "text-muted-foreground",
              )}
            />
            <Switch
              checked={stage.isHumanHandoff}
              onCheckedChange={(checked) =>
                updateStage.mutate({
                  id: stage.id,
                  input: { isHumanHandoff: checked },
                })
              }
              aria-label={`Intervenção humana na etapa ${stage.name}`}
            />
          </label>
        </TooltipTrigger>
        <TooltipContent>
          Intervenção humana: a IA move conversas para cá quando precisa de um
          atendente.
        </TooltipContent>
      </Tooltip>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        disabled={deleteStage.isPending}
        onClick={() => deleteStage.mutate(stage.id)}
        aria-label={`Excluir etapa ${stage.name}`}
      >
        {deleteStage.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Aba Etapas
// ---------------------------------------------------------------------------

export function StagesSettings() {
  const stagesQuery = useStages();
  const reorderStages = useReorderStages();
  const createStage = useCreateStage();

  const stages = stagesQuery.data ?? [];

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(COLOR_PALETTE[0]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = stages.findIndex((stage) => stage.id === active.id);
    const newIndex = stages.findIndex((stage) => stage.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(stages, oldIndex, newIndex);
    reorderStages.mutate(reordered.map((stage) => stage.id));
  };

  const handleCreate = (event: React.FormEvent): void => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length === 0 || createStage.isPending) return;
    createStage.mutate(
      { name, color: newColor },
      {
        onSuccess: () => {
          setNewName("");
        },
      },
    );
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Etapas do pipeline</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Arraste para reordenar as colunas do kanban. A etapa com “Intervenção
          humana” recebe conversas transferidas pela IA.
        </p>
      </div>

      {stagesQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={stages.map((stage) => stage.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2">
              {stages.map((stage) => (
                <StageRow key={stage.id} stage={stage} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {/* Criar etapa */}
      <form
        onSubmit={handleCreate}
        className="flex items-end gap-2 rounded-lg border border-dashed p-3"
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="new-stage-name" className="text-xs">
            Nova etapa
          </Label>
          <div className="flex items-center gap-2">
            <ColorPicker value={newColor} onChange={setNewColor} label="Cor da nova etapa" />
            <Input
              id="new-stage-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ex.: Qualificação"
              className="h-9"
            />
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          className="gap-1.5"
          disabled={newName.trim().length === 0 || createStage.isPending}
        >
          {createStage.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Criar
        </Button>
      </form>
    </div>
  );
}
