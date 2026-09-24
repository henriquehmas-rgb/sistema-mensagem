import { api } from "@/lib/api";

export type FollowUpStatus = "SCHEDULED" | "READY_FOR_REVIEW" | "PAUSED" | "CANCELLED" | "COMPLETED";

export interface FollowUpDto {
  id: string;
  conversationId: string;
  status: FollowUpStatus;
  mode: "REVIEW";
  currentStep: number;
  consentAt: string;
  nextRunAt: string | null;
  pausedReason: string | null;
  lastSentAt: string | null;
  createdAt: string;
  conversation: {
    id: string;
    protocol: string;
    caseSummary: string | null;
    channel: { id: string; name: string; type: string } | null;
    contact: { id: string; name: string | null } | null;
  };
}

export function listFollowUps(status: FollowUpStatus = "READY_FOR_REVIEW") {
  return api.get<FollowUpDto[]>("/follow-ups", { query: { status } });
}

export function reviewFollowUp(id: string, decision: "CONTACTED" | "PAUSE" | "CANCEL") {
  return api.patch<FollowUpDto>(`/follow-ups/${id}/review`, { body: { decision } });
}
