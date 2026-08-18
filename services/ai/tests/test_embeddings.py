"""MockEmbeddings: determinismo, dimensao e normalizacao."""

from __future__ import annotations

import math

from src.config import Settings
from src.embeddings import EMBEDDING_DIMENSION, MockEmbeddings, get_embedding_provider


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


def test_factory_falls_back_to_mock_without_openai_key() -> None:
    settings = Settings(ai_provider="anthropic", ai_service_token="t", openai_api_key="")
    assert isinstance(get_embedding_provider(settings), MockEmbeddings)
