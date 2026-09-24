"""Configuracao central via variaveis de ambiente (pydantic-settings)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AiProvider = Literal["mock", "openai", "anthropic", "google"]

# Parametros aceitos pelo Prisma mas rejeitados pela libpq/psycopg.
_PRISMA_ONLY_PARAMS = frozenset(
    {
        "schema",
        "connection_limit",
        "pool_timeout",
        "pgbouncer",
        "statement_cache_size",
        "socket_timeout",
    }
)


def normalize_database_url(url: str) -> str:
    """Converte uma DATABASE_URL (Prisma/SQLAlchemy) para conninfo aceito pelo psycopg.

    - ``postgres://`` e prefixos SQLAlchemy (``postgresql+psycopg://`` etc.) viram
      ``postgresql://``;
    - parametros exclusivos do Prisma (``schema``, ``connection_limit``, ...) sao
      removidos; ``schema=X`` e mapeado para ``options=-csearch_path=X``.
    """
    url = url.strip()
    for prefix in (
        "postgresql+psycopg2://",
        "postgresql+psycopg://",
        "postgresql+asyncpg://",
        "postgres://",
    ):
        if url.startswith(prefix):
            url = "postgresql://" + url[len(prefix) :]
            break

    parts = urlsplit(url)
    if parts.scheme != "postgresql" or not parts.query:
        return url

    params = parse_qsl(parts.query, keep_blank_values=True)
    kept = [(key, value) for key, value in params if key not in _PRISMA_ONLY_PARAMS]
    schema = next((value for key, value in params if key == "schema" and value), None)
    if schema and not any(key == "options" for key, _ in kept):
        kept.append(("options", f"-csearch_path={schema}"))

    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))


class Settings(BaseSettings):
    """Variaveis de ambiente do servico (ver .env.example)."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = "postgresql://sm:sm@localhost:5432/sm"
    ai_service_token: str = ""
    ai_provider: AiProvider = "mock"
    # Papeis independentes permitem trocar fornecedor sem alterar o fluxo.
    # Quando ausentes, preservam AI_PROVIDER como padrao retrocompativel.
    ai_primary_provider: AiProvider | None = None
    ai_auxiliary_provider: AiProvider | None = None
    ai_review_provider: AiProvider | None = None
    ai_fallback_provider: AiProvider | None = None

    # Rastreamento de erros (CONTRACTS §14) — opcional; vazio = sentry-sdk
    # nem e importado (ver src/observability.py). Mesmo nome de env var do
    # servico api (SENTRY_DSN), whitelisted separadamente para o container
    # ai em infra/docker-compose.yml.
    sentry_dsn: str = ""

    openai_api_key: str = ""
    anthropic_api_key: str = ""
    google_api_key: str = ""

    openai_chat_model: str = "gpt-4o-mini"
    anthropic_chat_model: str = "claude-haiku-4-5"
    google_chat_model: str = "gemini-2.0-flash"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = "low"
    openai_max_output_tokens: int = 512
    anthropic_max_output_tokens: int = 1024
    anthropic_prompt_cache_enabled: bool = False
    anthropic_prompt_cache_ttl: Literal["5m", "1h"] = "5m"

    # Monitor de custo: estimativa operacional, nunca bloqueia atendimento.
    ai_monthly_attention_budget_brl: float = 2500.0
    ai_budget_recipient_email: str = ""
    ai_usd_to_brl: float = 6.0
    openai_luna_input_usd_per_million: float = 0.20
    openai_luna_cached_input_usd_per_million: float = 0.02
    openai_luna_cache_write_usd_per_million: float = 0.25
    openai_luna_output_usd_per_million: float = 1.20
    anthropic_sonnet_input_usd_per_million: float = 2.0
    anthropic_sonnet_cached_input_usd_per_million: float = 0.20
    anthropic_sonnet_cache_write_usd_per_million: float = 2.50
    anthropic_sonnet_output_usd_per_million: float = 10.0
    openai_embedding_usd_per_million: float = 0.02

    # A dimensao dos embeddings e FIXA em 1536 pelo schema vector(1536) do
    # CONTRACTS §11 (constante embeddings.EMBEDDING_DIMENSION) — nao e configuravel.
    llm_timeout_seconds: float = 30.0
    chunk_size: int = 3000
    chunk_overlap: int = 400
    retrieval_top_k: int = 6
    retrieval_min_score: float = 0.45

    # Rotas homologadas para o piloto conversacional. A expansão exige uma
    # alteração explícita de configuração e homologação própria; não basta
    # ativar uma skill ou ingerir documentos. O padrão mantém só Suporte.
    # O valor usa vírgulas: ``technical_support,billing``.
    pilot_route_keys: str = "technical_support"

    # Link público V3 do formulário oficial de auto-viabilidade do IXC. O
    # atendimento apenas o apresenta ao cliente: não repassa o endereço
    # informado na conversa, nem conclui cobertura antes da evidência factual.
    ixc_inmap_auto_viability_public_url: str = ""

    # CONTRACTS §15 — cap do resumo de memoria de longo prazo por contato.
    # Fonte UNICA: usado tanto para o truncamento em routes/memory.py quanto
    # no texto da instrucao ao LLM em llm/prompts.py::build_memory_prompt —
    # nao duplicar este numero em outro lugar.
    memory_summary_max_chars: int = 1500

    @field_validator(
        "ai_primary_provider",
        "ai_auxiliary_provider",
        "ai_review_provider",
        "ai_fallback_provider",
        mode="before",
    )
    @classmethod
    def _empty_provider_is_none(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("ixc_inmap_auto_viability_public_url")
    @classmethod
    def _official_auto_viability_url_only(cls, value: str) -> str:
        """Aceita apenas o link HTTPS canônico da auto-viabilidade V3.

        Esse limite evita que uma variável de ambiente incorreta transforme a
        resposta comercial em redirecionamento para uma página arbitrária.
        """
        value = value.strip()
        if not value:
            return ""
        parts = urlsplit(value)
        params = dict(parse_qsl(parts.query, keep_blank_values=True))
        if (
            parts.scheme != "https"
            or not parts.netloc
            or parts.username
            or parts.password
            or parts.path.rstrip("/") != "/app/inmap-auto-viability"
            or not params.get("campaignId", "").isdigit()
            or not params.get("channelId", "").isdigit()
        ):
            raise ValueError(
                "IXC_INMAP_AUTO_VIABILITY_PUBLIC_URL deve ser o link HTTPS "
                "oficial /app/inmap-auto-viability com campaignId e channelId"
            )
        return value

    @property
    def psycopg_dsn(self) -> str:
        """DATABASE_URL normalizada para o formato aceito pelo psycopg."""
        return normalize_database_url(self.database_url)

    def is_pilot_route_enabled(self, route_key: str) -> bool:
        """Retorna se a rota foi liberada explicitamente para o piloto."""
        enabled_routes = {
            key.strip()
            for key in self.pilot_route_keys.split(",")
            if key.strip()
        }
        return route_key in enabled_routes


@lru_cache
def get_settings() -> Settings:
    return Settings()
