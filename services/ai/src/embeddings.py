"""Provedores de embeddings: OpenAI (text-embedding-3-small) e Mock deterministico."""

from __future__ import annotations

import hashlib
import math
import random
from abc import ABC, abstractmethod
from collections.abc import Sequence

from .config import Settings, get_settings

EMBEDDING_DIMENSION = 1536


class EmbeddingProvider(ABC):
    """Interface comum: `embed(texts)` retorna um vetor (dim 1536) por texto."""

    dimension: int = EMBEDDING_DIMENSION

    @abstractmethod
    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        """Gera embeddings na mesma ordem dos textos de entrada."""


class MockEmbeddings(EmbeddingProvider):
    """Embeddings deterministicos para dev/testes sem chave de API.

    sha256(texto) semeia um PRNG; o vetor uniforme resultante e L2-normalizado.
    O mesmo texto SEMPRE produz o mesmo vetor (em qualquer maquina/execucao).
    """

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        rng = random.Random(int.from_bytes(digest[:8], "big"))
        values = [rng.uniform(-1.0, 1.0) for _ in range(self.dimension)]
        norm = math.sqrt(sum(value * value for value in values)) or 1.0
        return [value / norm for value in values]


class OpenAIEmbeddings(EmbeddingProvider):
    """text-embedding-3-small (1536 dims) com envio em lotes."""

    def __init__(
        self,
        api_key: str,
        model: str = "text-embedding-3-small",
        batch_size: int = 128,
        timeout: float = 60.0,
    ) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key, timeout=timeout)
        self._model = model
        self._batch_size = batch_size

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        items = list(texts)
        vectors: list[list[float]] = []
        for start in range(0, len(items), self._batch_size):
            batch = items[start : start + self._batch_size]
            response = self._client.embeddings.create(model=self._model, input=batch)
            ordered = sorted(response.data, key=lambda item: item.index)
            vectors.extend(item.embedding for item in ordered)
        return vectors


def get_embedding_provider(settings: Settings | None = None) -> EmbeddingProvider:
    """Seleciona o provedor de embeddings a partir de AI_PROVIDER.

    - ``mock`` → MockEmbeddings;
    - ``openai`` → OpenAIEmbeddings (exige OPENAI_API_KEY);
    - ``anthropic``/``google`` → nao possuem API de embeddings 1536-dim: usa
      OpenAI se houver OPENAI_API_KEY, senao MockEmbeddings (dev sem chave).
    """
    settings = settings or get_settings()
    if settings.ai_provider == "mock":
        return MockEmbeddings()
    if settings.openai_api_key:
        return OpenAIEmbeddings(
            api_key=settings.openai_api_key,
            model=settings.openai_embedding_model,
        )
    if settings.ai_provider == "openai":
        raise RuntimeError("OPENAI_API_KEY e obrigatoria quando AI_PROVIDER=openai")
    return MockEmbeddings()
