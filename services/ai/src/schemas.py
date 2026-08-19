"""DTOs (pydantic) das rotas — payloads conforme CONTRACTS §7."""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

SourceType = Literal["PDF", "URL", "TEXT", "TABLE"]
ChatRole = Literal["user", "assistant", "system"]


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


class ReplyRequest(BaseModel):
    org_id: str = Field(min_length=1)
    conversation_id: str = Field(min_length=1)
    messages: list[ChatMessageIn]
    contact: ContactInfo | None = None


class ReplyResponse(BaseModel):
    reply: str | None
    handoff: bool
    handoff_reason: str | None = None
    confidence: float
    sources: list[str]


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


class HealthResponse(BaseModel):
    # 'degraded' quando o DB esta inacessivel (HTTP segue 200 — padrao do
    # health da api, CONTRACTS §6); monitores devem olhar este campo.
    status: Literal["ok", "degraded"]
    provider: str
    db: bool
