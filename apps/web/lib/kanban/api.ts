import type { ConversationDto } from "@sm/shared";

import { api } from "@/lib/api";

export interface MoveConversationInput {
  conversationId: string;
  stageId: string;
  stagePosition: number;
}

/** POST /conversations/:id/move — docs/CONTRACTS.md §6 (kanban). */
export function moveConversation({
  conversationId,
  stageId,
  stagePosition,
}: MoveConversationInput): Promise<ConversationDto | void> {
  return api.post<ConversationDto | void>(`/conversations/${conversationId}/move`, {
    body: { stageId, stagePosition },
  });
}
