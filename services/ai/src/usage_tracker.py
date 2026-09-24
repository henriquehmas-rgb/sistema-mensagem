"""Persistência best-effort do consumo de IA e alertas mensais não bloqueantes."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date
import logging
from typing import Iterator

from . import db
from .config import get_settings
from .llm.base import UsageSnapshot

logger = logging.getLogger(__name__)
_scope: ContextVar[tuple[str, str] | None] = ContextVar("ai_usage_scope", default=None)
_THRESHOLDS = (50, 75, 90, 100)


@contextmanager
def usage_scope(org_id: str, operation: str) -> Iterator[None]:
    token = _scope.set((org_id, operation))
    try:
        yield
    finally:
        _scope.reset(token)


def _cost_usd(provider: str, usage: UsageSnapshot) -> float:
    settings = get_settings()
    million = 1_000_000.0
    if provider == "anthropic":
        return (
            usage.input_tokens * settings.anthropic_sonnet_input_usd_per_million
            + usage.cached_input_tokens * settings.anthropic_sonnet_cached_input_usd_per_million
            + usage.cache_creation_input_tokens * settings.anthropic_sonnet_cache_write_usd_per_million
            + usage.output_tokens * settings.anthropic_sonnet_output_usd_per_million
        ) / million
    if provider == "openai" and usage.model == get_settings().openai_embedding_model:
        return usage.input_tokens * settings.openai_embedding_usd_per_million / million
    if provider == "openai":
        ordinary = max(
            0,
            usage.input_tokens - usage.cached_input_tokens - usage.cache_creation_input_tokens,
        )
        return (
            ordinary * settings.openai_luna_input_usd_per_million
            + usage.cached_input_tokens * settings.openai_luna_cached_input_usd_per_million
            + usage.cache_creation_input_tokens * settings.openai_luna_cache_write_usd_per_million
            + usage.output_tokens * settings.openai_luna_output_usd_per_million
        ) / million
    return 0.0


def record_usage(provider: str, usage: UsageSnapshot | None) -> None:
    context = _scope.get()
    if context is None or usage is None:
        return
    org_id, operation = context
    settings = get_settings()
    estimated_usd = _cost_usd(provider, usage)
    estimated_brl = estimated_usd * settings.ai_usd_to_brl
    try:
        db.execute(
            """
            INSERT INTO ai_usage_events (
              id, org_id, provider, model, operation, input_tokens, output_tokens,
              cached_input_tokens, cache_creation_tokens, reasoning_tokens,
              estimated_usd, estimated_brl
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                db.new_cuid(), org_id, provider, usage.model, operation,
                usage.input_tokens, usage.output_tokens, usage.cached_input_tokens,
                usage.cache_creation_input_tokens, usage.reasoning_tokens,
                estimated_usd, estimated_brl,
            ),
        )
        _create_reached_alerts(org_id)
    except Exception:  # observabilidade nunca interrompe atendimento
        logger.exception("falha ao persistir consumo de IA; atendimento preservado")


def _create_reached_alerts(org_id: str) -> None:
    settings = get_settings()
    budget = settings.ai_monthly_attention_budget_brl
    if budget <= 0 or not settings.ai_budget_recipient_email:
        return
    rows = db.fetch_all(
        """
        SELECT COALESCE(SUM(estimated_brl), 0)::float8
        FROM ai_usage_events
        WHERE org_id = %s AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
        """,
        (org_id,),
    )
    spent = float(rows[0][0] if rows else 0.0)
    percentage = spent / budget * 100
    month_start = date.today().replace(day=1)
    for threshold in _THRESHOLDS:
        if percentage < threshold:
            continue
        db.execute(
            """
            INSERT INTO ai_budget_alerts (
              id, org_id, month_start, threshold, estimated_brl, budget_brl, recipient_email
            ) VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (org_id, month_start, threshold) DO NOTHING
            """,
            (
                db.new_cuid(), org_id, month_start, threshold, spent, budget,
                settings.ai_budget_recipient_email,
            ),
        )
