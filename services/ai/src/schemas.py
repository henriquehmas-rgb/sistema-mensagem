"""DTOs (pydantic) das rotas — payloads conforme CONTRACTS §7."""

from __future__ import annotations

from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

SourceType = Literal["PDF", "URL", "TEXT", "TABLE"]
ChatRole = Literal["user", "assistant", "system"]
SkillText = Annotated[str, Field(min_length=1, max_length=500)]


class IngestRequest(BaseModel):
    org_id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    type: SourceType
    content_url: str | None = None
    content_text: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _validate_content(self) -> "IngestRequest":
        if self.type in ("PDF", "URL"):
            url = (self.content_url or "").strip()
            if not url:
                raise ValueError("content_url e obrigatorio para fontes PDF e URL")
            # Primeira barreira anti-SSRF (esquema); a validacao de IP privado/
            # metadata acontece no fetch (ingest._validate_public_http_url).
            if urlsplit(url).scheme.lower() not in ("http", "https"):
                raise ValueError("content_url deve usar o esquema http ou https")
        if self.type in ("TEXT", "TABLE") and not (
            self.content_text and self.content_text.strip()
        ):
            raise ValueError("content_text e obrigatorio para fontes TEXT e TABLE")
        return self


class IngestAccepted(BaseModel):
    status: Literal["accepted"] = "accepted"
    source_id: str


class QueryRequest(BaseModel):
    org_id: str = Field(min_length=1)
    query: str = Field(min_length=1)
    top_k: int = Field(default=6, ge=1, le=50)


class ChunkResult(BaseModel):
    content: str
    score: float
    source_id: str


class QueryResponse(BaseModel):
    chunks: list[ChunkResult]


class ChatMessageIn(BaseModel):
    role: ChatRole
    content: str


class ContactInfo(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    name: str | None = None
    # CONTRACTS §15 — resumo de memória de longo prazo do contato
    # (`Contact.memorySummary`); a api envia o payload JSON com a chave
    # literal `memorySummary` (mesmo nome do campo no Prisma/DTO), daí o alias.
    memory_summary: str | None = Field(default=None, alias="memorySummary")


class OperationalContext(BaseModel):
    identity_verified: bool = False
    # Falhar sem pedir dado pessoal é mais seguro que induzir uma validação por
    # omissão de um cliente antigo. A API atual envia True somente quando há
    # consulta individual explícita de conta, chamado ou OS.
    identity_required_now: bool = False
    # Recuperação de identidade somente se o contato não possui telefone.
    # É um sinal de política, não um dado de identificação.
    identity_phone_required: bool = False
    # Resultado mínimo da pré-busca no IXC; não contém nome, contrato nem ID.
    identity_phone_candidate_status: Literal["candidate_ready", "no_candidate", "unavailable"] | None = None
    case_state: dict[str, Any] | None = None
    planned_actions: list[Literal["contracts", "invoices", "service_orders", "connections", "fiber_access", "tickets"]] = Field(default_factory=list)
    previous_intent: str | None = None
    triage_confidence: float | None = Field(default=None, ge=0, le=1)
    evidence: dict[str, Any] | None = None
    network_context: dict[str, Any] | None = None
    # Só contagens e estado do IXC: os identificadores internos continuam no backend.
    structural_incident: dict[str, Any] | None = None
    # Estado operacional mínimo: não contém cliente, contrato, endereço ou
    # identificador do evento. Só é informado após o registro deduplicado.
    regional_incident: dict[str, str] | None = None
    continued_from_previous: bool = False
    cache_hit_actions: list[str] = Field(default_factory=list)
    fresh_actions: list[str] = Field(default_factory=list)
    gap_resolution: dict[str, str] | None = None


class OperationalSkillIn(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    version: int = Field(ge=1)
    route_key: str | None = Field(default=None, max_length=80)
    trigger_conditions: list[SkillText] = Field(default_factory=list, max_length=30)
    required_data: list[SkillText] = Field(default_factory=list, max_length=30)
    allowed_sources: list[SkillText] = Field(default_factory=list, max_length=30)
    protocol_steps: list[SkillText] = Field(default_factory=list, max_length=50)
    allowed_actions: list[SkillText] = Field(default_factory=list, max_length=30)
    forbidden_actions: list[SkillText] = Field(default_factory=list, max_length=30)
    completion_criteria: list[SkillText] = Field(default_factory=list, max_length=30)
    review_conditions: list[SkillText] = Field(default_factory=list, max_length=30)
    human_handoff_conditions: list[SkillText] = Field(default_factory=list, max_length=30)
    identity_requirement: str = Field(default="NONE", max_length=40)
    minimum_confidence: float = Field(default=0.8, ge=0, le=1)


class GlobalDirectiveIn(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=60)
    version: int = Field(ge=1)
    priority: int = Field(default=100, ge=1, le=1000)
    principles: list[SkillText] = Field(default_factory=list, max_length=50)
    prohibitions: list[SkillText] = Field(default_factory=list, max_length=50)


class ReplyRequest(BaseModel):
    org_id: str = Field(min_length=1)
    conversation_id: str = Field(min_length=1)
    messages: list[ChatMessageIn]
    contact: ContactInfo | None = None
    clarification_count: int = Field(default=0, ge=0, le=10)
    identity_verified: bool = False
    global_directives: list[GlobalDirectiveIn] = Field(default_factory=list, max_length=30)
    operational_skills: list[OperationalSkillIn] = Field(default_factory=list, max_length=30)
    operational_context: OperationalContext = Field(default_factory=OperationalContext)


class ReplyResponse(BaseModel):
    reply: str | None
    handoff: bool
    handoff_reason: str | None = None
    confidence: float
    sources: list[str]
    intent: str
    route_key: str
    triage_confidence: float
    case_summary: str | None = None
    clarification: bool = False
    conversation_level: str = "direto"
    secondary_intent: str | None = None
    alternative_route_key: str | None = None
    conflict_detected: bool = False
    routing_evidence: list[str] = Field(default_factory=list)
    selected_skill_key: str | None = None
    selected_skill_version: int | None = None


class TriageAnalyzeRequest(BaseModel):
    messages: list[ChatMessageIn] = Field(default_factory=list)


class TriageAnalyzeResponse(BaseModel):
    intent: str
    route_key: str
    triage_confidence: float
    case_summary: str | None = None
    secondary_intent: str | None = None
    alternative_route_key: str | None = None
    conflict_detected: bool = False
    routing_evidence: list[str] = Field(default_factory=list)


MemoryRole = Literal["user", "assistant"]


class MemoryMessageIn(BaseModel):
    role: MemoryRole
    content: str


class MemorySummarizeRequest(BaseModel):
    org_id: str = Field(min_length=1)
    existing_summary: str | None = None
    messages: list[MemoryMessageIn] = Field(default_factory=list)


class MemorySummarizeResponse(BaseModel):
    summary: str | None = None


class LearningCandidateRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=5000)
    department_key: str | None = Field(default=None, max_length=80)


class LearningCandidateResponse(BaseModel):
    eligible: bool
    content: str | None = None
    rejection_reason: str | None = None
    quality_score: float = 0.0
    fingerprint: str | None = None
    auto_publish_eligible: bool = False


class HealthResponse(BaseModel):
    # 'degraded' quando o DB esta inacessivel (HTTP segue 200 — padrao do
    # health da api, CONTRACTS §6); monitores devem olhar este campo.
    status: Literal["ok", "degraded"]
    provider: str
    embedding_provider: str
    production_ready: bool
    db: bool
