"""MockEmbeddings: determinismo, dimensao e normalizacao."""

from __future__ import annotations

import math

from src.config import Settings
from src.embeddings import (
    EMBEDDING_DIMENSION,
    MockEmbeddings,
    embedding_provider_fingerprint,
    get_embedding_provider,
    production_ai_ready,
)


def test_mock_embeddings_are_deterministic() -> None:
    provider = MockEmbeddings()
    first = provider.embed(["qual o prazo de entrega?"])[0]
    second = MockEmbeddings().embed(["qual o prazo de entrega?"])[0]
    assert first == second


def test_mock_embeddings_dimension_and_norm() -> None:
    vector = MockEmbeddings().embed(["texto de teste"])[0]
    assert len(vector) == EMBEDDING_DIMENSION
    norm = math.sqrt(sum(value * value for value in vector))
    assert math.isclose(norm, 1.0, rel_tol=1e-9)


def test_different_texts_produce_different_vectors() -> None:
    provider = MockEmbeddings()
    vec_a, vec_b = provider.embed(["politica de trocas", "horario de funcionamento"])
    assert vec_a != vec_b


def test_batch_preserves_order() -> None:
    provider = MockEmbeddings()
    texts = ["a", "b", "c"]
    batch = provider.embed(texts)
    singles = [provider.embed([text])[0] for text in texts]
    assert batch == singles


def test_factory_returns_mock_for_mock_provider() -> None:
    settings = Settings(ai_provider="mock", ai_service_token="t")
    assert isinstance(get_embedding_provider(settings), MockEmbeddings)


def test_production_readiness_requires_real_chat_and_semantic_embeddings() -> None:
    mock = Settings(ai_provider="mock", ai_service_token="t")
    anthropic_without_embeddings = Settings(
        ai_provider="anthropic", anthropic_api_key="chat-key", openai_api_key=""
    )
    openai = Settings(ai_provider="openai", openai_api_key="api-key")

    assert not production_ai_ready(mock)
    assert not production_ai_ready(anthropic_without_embeddings)
    assert production_ai_ready(openai)
    assert embedding_provider_fingerprint(openai) == "openai:text-embedding-3-small"


def test_factory_falls_back_to_mock_without_openai_key() -> None:
    settings = Settings(ai_provider="anthropic", ai_service_token="t", openai_api_key="")
    assert isinstance(get_embedding_provider(settings), MockEmbeddings)
