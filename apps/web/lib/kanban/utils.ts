import type { ConversationDto, PipelineStageDto } from "@sm/shared";

/** Coluna do board: etapa + conversas ordenadas por stagePosition. */
export interface KanbanColumnData {
  stage: PipelineStageDto;
  conversations: ConversationDto[];
}

/**
 * Agrupa as conversas por etapa, ordenadas por `stagePosition` (asc).
 * Conversas sem etapa entram na etapa default (ou na primeira coluna).
 */
export function groupConversationsByStage(
  conversations: ConversationDto[],
  stages: PipelineStageDto[],
): KanbanColumnData[] {
  const fallbackStage = stages.find((stage) => stage.isDefault) ?? stages[0];
  const byStage = new Map<string, ConversationDto[]>(
    stages.map((stage) => [stage.id, []]),
  );

  for (const conversation of conversations) {
    const stageId =
      conversation.stageId !== null && byStage.has(conversation.stageId)
        ? conversation.stageId
        : fallbackStage?.id;
    if (stageId === undefined) continue;
    byStage.get(stageId)?.push(conversation);
  }

  return stages.map((stage) => ({
    stage,
    conversations: (byStage.get(stage.id) ?? []).sort(
      (a, b) => a.stagePosition - b.stagePosition || a.id.localeCompare(b.id),
    ),
  }));
}

/**
 * Posição fracionária do card ao ser solto no índice `index` da coluna:
 * média entre os vizinhos (before/after); extremos ganham ±1; coluna vazia = 1.
 * A lista recebida NÃO deve conter o card sendo movido.
 */
export function computeStagePosition(
  columnWithoutDragged: readonly ConversationDto[],
  index: number,
): number {
  const before = columnWithoutDragged[index - 1]?.stagePosition;
  const after = columnWithoutDragged[index]?.stagePosition;
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return 1;
}

/** Prefixo dos droppables de coluna no DndContext. */
export const COLUMN_DROPPABLE_PREFIX = "stage:";

export function columnDroppableId(stageId: string): string {
  return `${COLUMN_DROPPABLE_PREFIX}${stageId}`;
}

export function stageIdFromDroppable(droppableId: string): string | null {
  return droppableId.startsWith(COLUMN_DROPPABLE_PREFIX)
    ? droppableId.slice(COLUMN_DROPPABLE_PREFIX.length)
    : null;
}
