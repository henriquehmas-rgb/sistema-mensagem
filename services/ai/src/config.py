"""Configuracao central via variaveis de ambiente (pydantic-settings)."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

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

    # A dimensao dos embeddings e FIXA em 1536 pelo schema vector(1536) do
    # CONTRACTS §11 (constante embeddings.EMBEDDING_DIMENSION) — nao e configuravel.
    llm_timeout_seconds: float = 30.0
    chunk_size: int = 3000
    chunk_overlap: int = 400
    retrieval_top_k: int = 6

    # CONTRACTS §15 — cap do resumo de memoria de longo prazo por contato.
    # Fonte UNICA: usado tanto para o truncamento em routes/memory.py quanto
    # no texto da instrucao ao LLM em llm/prompts.py::build_memory_prompt —
    # nao duplicar este numero em outro lugar.
    memory_summary_max_chars: int = 1500

    @property
    def psycopg_dsn(self) -> str:
        """DATABASE_URL normalizada para o formato aceito pelo psycopg."""
        return normalize_database_url(self.database_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
