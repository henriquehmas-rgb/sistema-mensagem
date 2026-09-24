import { api } from "@/lib/api";

export type OperationalActionRequestStatus =
  | "PENDING_REVIEW"
  | "APPROVED"
  | "READY_TO_TRIGGER"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "UNCERTAIN"
  | "DUPLICATE_FOUND"
  | "BLOCKED"
  | "REJECTED"
  | "CANCELLED";

export interface OperationalActionProposalDto {
  id: string;
  conversationId: string;
  skillId: string;
  requestedAction: "request_ticket" | "request_service_order";
  requestPayload: {
    intent?: string;
    mappingKey: string;
    mappingVersion?: number;
    mappingStatus?: "DRAFT" | "ACTIVE";
    subjectId?: string;
    customerId?: string;
    contractId?: string;
    networkDiagnosis?: string | null;
    occurrenceId?: string | null;
    occurrenceKey?: string;
    occurrenceSource?: "OMNI_OCCURRENCE_ID" | "NETWORK_EVENT_ID" | "CONVERSATION_FALLBACK";
    networkEventId?: string | null;
    duplicateStrategy?: string;
  };
  status: OperationalActionRequestStatus;
  requestedById: string | null;
  reviewedById: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  deduplicationKey: string;
  skill: { id: string; key: string; name: string; version: number };
  conversation: {
    id: string;
    protocol: string;
    caseSummary: string | null;
    departmentId: string | null;
  };
}

export interface HomologationPlanDto {
  mode: "SHADOW";
  externalWriteEnabled: false;
  requiredModeForFirstRealTest: "REVIEW_REQUIRED";
  scenarios: Array<{
    id: string;
    title: string;
    action: "request_ticket" | "request_service_order";
    setup: string[];
    expectedState: "READY_TO_TRIGGER" | "REVIEW_REQUIRED" | "DUPLICATE_FOUND" | "BLOCKED" | "UNCERTAIN";
    expectedBehavior: string;
    externalWriteExpected: false;
  }>;
}

export function getHomologationPlan() {
  return api.get<HomologationPlanDto>("/operational-actions/homologation-plan");
}

export function listOperationalActionProposals(status?: OperationalActionRequestStatus) {
  return api.get<OperationalActionProposalDto[]>("/operational-actions/proposals", {
    query: { status },
  });
}

export function reviewOperationalActionProposal(
  id: string,
  decision: "APPROVED" | "REJECTED",
  note?: string,
) {
  return api.patch<OperationalActionProposalDto>(
    `/operational-actions/proposals/${id}/review`,
    { body: { decision, note: note?.trim() || undefined } },
  );
}
