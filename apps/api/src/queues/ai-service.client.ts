import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SourceType } from '@prisma/client';
import type { Env } from '../config/env.validation';
import type { OmniNetworkResolution } from '../integrations/olho-de-deus/olho-de-deus.types';
import type { IxcStructuralIncidentEvidence } from '../integrations/ixc/ixc.types';
import type { OperationalCaseState } from '../support-case-state/support-case-state.types';

/** Contratos do serviço de IA (FastAPI) — CONTRACTS §7. Campos em snake_case. */

export interface AiReplyRequest {
  org_id: string;
  conversation_id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  contact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    /** Memória de longo prazo do contato (CONTRACTS §15) — pode ser null. */
    memorySummary: string | null;
  };
  clarification_count: number;
  identity_verified: boolean;
  global_directives: Array<{
    key: string;
    title: string;
    category: string;
    version: number;
    priority: number;
    principles: string[];
    prohibitions: string[];
  }>;
  operational_skills: Array<{
    key: string;
    name: string;
    version: number;
    route_key: string | null;
    trigger_conditions: string[];
    required_data: string[];
    allowed_sources: string[];
    protocol_steps: string[];
    allowed_actions: string[];
    forbidden_actions: string[];
    completion_criteria: string[];
    review_conditions: string[];
    human_handoff_conditions: string[];
    identity_requirement: string;
    minimum_confidence: number;
  }>;
  operational_context: {
    identity_verified: boolean;
    /** True only when the current turn explicitly asks for account-specific data. */
    identity_required_now: boolean;
    /** Telefone só pode ser solicitado como recuperação quando ainda não existe no contato. */
    identity_phone_required: boolean;
    /** Resultado sanitizado da pré-busca por telefone; nunca inclui cadastro ou cliente. */
    identity_phone_candidate_status: 'candidate_ready' | 'no_candidate' | 'unavailable' | null;
    /** Estado operacional sem dados pessoais; é a fonte de continuidade do caso. */
    case_state: OperationalCaseState | null;
    planned_actions: string[];
    previous_intent: string | null;
    triage_confidence: number | null;
    evidence: {
      source: 'IXC';
      customerRef?: string;
      status: string;
      observedAt: string;
      facts: Array<{ resource: string; entityRef: string; fields: Record<string, string | number | boolean | null> }>;
    } | null;
    network_context: OmniNetworkResolution | null;
    /** Evidência IXC sanitizada: sem IDs de login, OS, região ou cliente. */
    structural_incident: Pick<IxcStructuralIncidentEvidence,
      'source' | 'status' | 'observedAt' | 'matchedLogins' | 'matchedMaintenanceRegions' | 'activeStructuralOrders'
    > | null;
    regional_incident: {
      status: 'REGISTERED';
      disposition: 'OPENED' | 'REOPENED_OR_REPEATED';
    } | null;
    continued_from_previous: boolean;
    cache_hit_actions: string[];
    fresh_actions: string[];
    gap_resolution: { gap_id: string; reason: string; guidance: string } | null;
  };
}

export interface AiReplyResponse {
  reply: string | null;
  handoff: boolean;
  handoff_reason?: string;
  confidence: number;
  sources: unknown[];
  intent?: string;
  route_key?: string;
  triage_confidence?: number;
  secondary_intent?: string | null;
  alternative_route_key?: string | null;
  conflict_detected?: boolean;
  routing_evidence?: string[];
  case_summary?: string | null;
  clarification?: boolean;
  conversation_level?: string;
  selected_skill_key?: string | null;
  selected_skill_version?: number | null;
}

export interface AiTriageResponse {
  intent: string;
  route_key: string;
  triage_confidence: number;
  secondary_intent?: string | null;
  alternative_route_key?: string | null;
  conflict_detected?: boolean;
  routing_evidence?: string[];
  case_summary: string | null;
}

export interface AiIngestRequest {
  org_id: string;
  source_id: string;
  type: SourceType;
  content_url?: string;
  content_text?: string;
  meta: Record<string, unknown>;
}

/** CONTRACTS §15 — funde `existing_summary` com os fatos novos de `messages`. */
export interface AiMemorySummarizeRequest {
  org_id: string;
  existing_summary: string | null;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AiMemorySummarizeResponse {
  /**
   * Pode vir `null`: o fail-safe do serviço de IA (LLM timeout/erro, ou
   * conversa sem mensagens) devolve `existing_summary` inalterado — que é
   * `null` quando o contato ainda não tinha nenhuma memória.
   */
  summary: string | null;
}

export interface AiLearningCandidateResponse {
  eligible: boolean;
  content: string | null;
  rejection_reason: string | null;
  quality_score: number;
  fingerprint: string | null;
  auto_publish_eligible: boolean;
}

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Cliente HTTP do serviço interno de IA (auth via X-Service-Token).
 * Erros HTTP/rede viram exceção — o processor deixa o BullMQ fazer retry.
 */
@Injectable()
export class AiServiceClient {
  private readonly logger = new Logger(AiServiceClient.name);
  private readonly baseUrl: string;
  private readonly serviceToken: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('AI_SERVICE_URL', { infer: true }).replace(/\/+$/, '');
    this.serviceToken = config.get('AI_SERVICE_TOKEN', { infer: true });
  }

  async reply(request: AiReplyRequest): Promise<AiReplyResponse> {
    return this.post<AiReplyResponse>('/reply', request);
  }

  async analyzeTriage(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<AiTriageResponse> {
    return this.post<AiTriageResponse>('/triage/analyze', { messages });
  }

  async ingest(request: AiIngestRequest): Promise<void> {
    await this.post<unknown>('/ingest', request);
  }

  async summarizeMemory(request: AiMemorySummarizeRequest): Promise<AiMemorySummarizeResponse> {
    return this.post<AiMemorySummarizeResponse>('/memory/summarize', request);
  }

  async prepareLearningCandidate(request: {
    question: string;
    answer: string;
    department_key?: string | null;
  }): Promise<AiLearningCandidateResponse> {
    return this.post<AiLearningCandidateResponse>('/learning/candidate', request);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': this.serviceToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn(`IA ${path} respondeu ${response.status}`);
      throw new Error(`Serviço de IA ${path} falhou: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }
}
