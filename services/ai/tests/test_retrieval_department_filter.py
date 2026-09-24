"""Regressão para o isolamento de candidatos RAG por setor."""

from __future__ import annotations

from src import retrieval


def test_search_passes_department_filter_to_mock_query(monkeypatch) -> None:
    """O filtro é aplicado antes da seleção de candidatos, não só na resposta."""
    monkeypatch.setattr(retrieval, "get_settings", lambda: object())
    monkeypatch.setattr(retrieval, "get_embedding_provider", lambda _settings: retrieval.MockEmbeddings())
    monkeypatch.setattr(retrieval, "embedding_provider_fingerprint", lambda _settings: "mock")

    calls: list[dict[str, object]] = []

    def fetch_all(_sql: str, params: dict[str, object]):
        calls.append(params)
        return []

    monkeypatch.setattr(retrieval.db, "fetch_all", fetch_all)

    assert retrieval.search("org", "segunda via da fatura", allowed_departments=("billing", "global")) == []
    assert calls
    assert calls[0]["departments"] == ["billing", "global"]


def test_department_filter_declares_postgres_array_type() -> None:
    """O parâmetro opcional precisa continuar tipado quando for ``None``."""
    assert "%(departments)s::text[] IS NULL" in retrieval._SEARCH_SQL
    assert "%(departments)s::text[] IS NULL" in retrieval._LEXICAL_CANDIDATE_SQL
    assert "%(departments)s::text[] IS NULL" in retrieval._MOCK_SEARCH_SQL


def test_candidate_window_leaves_room_for_diverse_sources() -> None:
    """Um catálogo fragmentado não pode preencher sozinho o top-k bruto."""
    assert retrieval.CANDIDATE_MULTIPLIER >= 12
