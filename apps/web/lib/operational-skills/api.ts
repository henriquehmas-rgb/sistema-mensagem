import { api } from "@/lib/api";

export type OperationalSkillStatus =
  | "DRAFT" | "IN_REVIEW" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "REPLACED";

export interface OperationalSkillDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  status: OperationalSkillStatus;
  owner: string | null;
  minimumConfidence: number;
  identityRequirement: string;
  triggerConditions: string[];
  requiredData: string[];
  allowedSources: string[];
  protocolSteps: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  completionCriteria: string[];
  reviewConditions: string[];
  humanHandoffConditions: string[];
  department: { id: string; name: string; routingKey: string | null } | null;
  createdAt: string;
  validUntil: string | null;
}

export interface CreateOperationalSkillInput {
  key: string;
  name: string;
  description?: string;
  departmentId?: string;
  owner?: string;
  identityRequirement: "NONE" | "LAST_3_CPF" | "STRONG";
  minimumConfidence: number;
  triggerConditions: string[];
  requiredData: string[];
  allowedSources: string[];
  protocolSteps: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  completionCriteria: string[];
  reviewConditions: string[];
  humanHandoffConditions: string[];
  validUntil?: string;
}

export const listOperationalSkills = () =>
  api.get<OperationalSkillDto[]>("/operational-skills");

export const createOperationalSkill = (input: CreateOperationalSkillInput) =>
  api.post<OperationalSkillDto>("/operational-skills", { body: input });

export const changeOperationalSkillStatus = (
  id: string,
  status: "IN_REVIEW" | "APPROVED" | "ACTIVE" | "SUSPENDED",
) => api.patch<OperationalSkillDto>(`/operational-skills/${id}/status`, { body: { status } });
