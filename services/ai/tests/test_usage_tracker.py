from types import SimpleNamespace

from src.llm.base import UsageSnapshot
from src import usage_tracker


def settings():
    return SimpleNamespace(
        ai_usd_to_brl=6.0, ai_monthly_attention_budget_brl=2500.0,
        ai_budget_recipient_email="leader@example.com",
        openai_embedding_model="text-embedding-3-small",
        openai_embedding_usd_per_million=0.02,
        openai_luna_input_usd_per_million=0.20,
        openai_luna_cached_input_usd_per_million=0.02,
        openai_luna_cache_write_usd_per_million=0.25,
        openai_luna_output_usd_per_million=1.20,
        anthropic_sonnet_input_usd_per_million=2.0,
        anthropic_sonnet_cached_input_usd_per_million=0.20,
        anthropic_sonnet_cache_write_usd_per_million=2.50,
        anthropic_sonnet_output_usd_per_million=10.0,
    )


def test_sonnet_cost_accounts_for_cache(monkeypatch) -> None:
    monkeypatch.setattr(usage_tracker, "get_settings", settings)
    cost = usage_tracker._cost_usd("anthropic", UsageSnapshot(
        model="claude-sonnet-5", input_tokens=1_000_000, output_tokens=100_000,
        cached_input_tokens=500_000, cache_creation_input_tokens=200_000,
    ))
    assert cost == 3.6


def test_reached_thresholds_are_persisted_without_blocking(monkeypatch) -> None:
    calls: list[tuple[str, tuple]] = []
    monkeypatch.setattr(usage_tracker, "get_settings", settings)
    monkeypatch.setattr(usage_tracker.db, "new_cuid", lambda: "event_id")
    monkeypatch.setattr(usage_tracker.db, "execute", lambda sql, params: calls.append((sql, params)) or 1)
    monkeypatch.setattr(usage_tracker.db, "fetch_all", lambda *_: [(2500.0,)])

    with usage_tracker.usage_scope("org_1", "reply"):
        usage_tracker.record_usage("openai", UsageSnapshot(model="gpt-5.6-luna", input_tokens=10))

    assert len(calls) == 5  # evento + alertas 50/75/90/100
    assert all("ON CONFLICT" in sql for sql, _ in calls[1:])


def test_tracking_failure_never_escapes(monkeypatch) -> None:
    monkeypatch.setattr(usage_tracker, "get_settings", settings)
    monkeypatch.setattr(usage_tracker.db, "execute", lambda *_: (_ for _ in ()).throw(RuntimeError("db down")))
    with usage_tracker.usage_scope("org_1", "reply"):
        usage_tracker.record_usage("openai", UsageSnapshot(model="gpt-5.6-luna", input_tokens=10))
