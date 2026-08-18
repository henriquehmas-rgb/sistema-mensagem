"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import type { ConversationDto, PipelineStageDto } from "@sm/shared";

import { useMoveConversation } from "@/lib/kanban/hooks";
import {
  computeStagePosition,
  groupConversationsByStage,
  stageIdFromDroppable,
  type KanbanColumnData,
} from "@/lib/kanban/utils";

import { KanbanCardContent } from "./kanban-card";
import { KanbanColumn } from "./kanban-column";

interface KanbanBoardProps {
  conversations: ConversationDto[];
  stages: PipelineStageDto[];
  onOpenConversation: (id: string) => void;
}

interface DropTarget {
  stageId: string;
  insertIndex: number;
}

/** Resolve a coluna + índice de inserção a partir do elemento sob o cursor. */
function resolveDropTarget(
  columns: KanbanColumnData[],
  draggedId: string,
  overId: string,
): DropTarget | null {
  const stageFromColumn = stageIdFromDroppable(overId);
  if (stageFromColumn !== null) {
    const column = columns.find((item) => item.stage.id === stageFromColumn);
    if (!column) return null;
    const withoutDragged = column.conversations.filter(
      (item) => item.id !== draggedId,
    );
    return { stageId: stageFromColumn, insertIndex: withoutDragged.length };
  }

  const column = columns.find((item) =>
    item.conversations.some((conversation) => conversation.id === overId),
  );
  if (!column) return null;

  const withoutDragged = column.conversations.filter(
    (item) => item.id !== draggedId,
  );
  let insertIndex = withoutDragged.findIndex((item) => item.id === overId);
  if (insertIndex === -1) insertIndex = withoutDragged.length;

  // Mesma coluna, movendo para baixo: solta DEPOIS do card sobreposto.
  const activeIndex = column.conversations.findIndex((item) => item.id === draggedId);
  const overIndex = column.conversations.findIndex((item) => item.id === overId);
  if (activeIndex !== -1 && overIndex !== -1 && activeIndex < overIndex) {
    insertIndex += 1;
  }

  return { stageId: column.stage.id, insertIndex };
}

export function KanbanBoard({
  conversations,
  stages,
  onOpenConversation,
}: KanbanBoardProps) {
  const moveMutation = useMoveConversation();

  // activationConstraint distance 6px: clique abre o sheet, arrasto move (sem lag).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const columns = useMemo(
    () => groupConversationsByStage(conversations, stages),
    [conversations, stages],
  );

  const [activeConversation, setActiveConversation] =
    useState<ConversationDto | null>(null);

  // Após um drop, o browser ainda dispara `click` no card — suprime a abertura
  // do sheet nesse caso (o clique "de verdade" nunca passa pelo drag).
  const suppressClickRef = useRef(false);

  const handleOpenConversation = useCallback(
    (id: string): void => {
      if (suppressClickRef.current) return;
      onOpenConversation(id);
    },
    [onOpenConversation],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent): void => {
      const conversation = conversations.find((item) => item.id === event.active.id);
      setActiveConversation(conversation ?? null);
      suppressClickRef.current = true;
    },
    [conversations],
  );

  const handleDragCancel = useCallback((): void => {
    setActiveConversation(null);
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      setActiveConversation(null);
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const { active, over } = event;
      if (!over || over.id === active.id) return;

      const draggedId = String(active.id);
      const dragged = conversations.find((item) => item.id === draggedId);
      if (!dragged) return;

      const target = resolveDropTarget(columns, draggedId, String(over.id));
      if (!target) return;

      const targetColumn = columns.find((item) => item.stage.id === target.stageId);
      if (!targetColumn) return;
      const withoutDragged = targetColumn.conversations.filter(
        (item) => item.id !== draggedId,
      );

      // No-op: soltou no mesmo lugar de onde saiu.
      if (target.stageId === dragged.stageId) {
        const currentIndex = targetColumn.conversations.findIndex(
          (item) => item.id === draggedId,
        );
        if (currentIndex === target.insertIndex) return;
      }

      const stagePosition = computeStagePosition(withoutDragged, target.insertIndex);
      moveMutation.mutate({
        conversationId: draggedId,
        stageId: target.stageId,
        stagePosition,
      });
    },
    [columns, conversations, moveMutation],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* Board horizontal scrollável */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4">
        {columns.map((column) => (
          <KanbanColumn
            key={column.stage.id}
            column={column}
            onOpenConversation={handleOpenConversation}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 180 }}>
        {activeConversation ? (
          <div className="w-[284px]">
            <KanbanCardContent conversation={activeConversation} overlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
