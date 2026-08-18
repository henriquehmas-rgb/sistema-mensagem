"""Busca semantica em knowledge_chunks (pgvector) com rerank hibrido.

Score hibrido = 0.75 * similaridade_cosseno + 0.25 * overlap de palavras-chave.
TODA query filtra por org_id (multitenancy obrigatoria — CONTRACTS §3/§11).
"""

from __future__ import annotations

from dataclasses import dataclass

from . import db
from .config import get_settings
from .embeddings import get_embedding_provider
from .textutils import clamp01, keyword_overlap

VECTOR_WEIGHT = 0.75
KEYWORD_WEIGHT = 0.25
CANDIDATE_MULTIPLIER = 3

_SEARCH_SQL = """
    SELECT content, source_id, 1 - (embedding <=> %(vec)s::vector) AS score
    FROM knowledge_chunks
    WHERE org_id = %(org_id)s
    ORDER BY embedding <=> %(vec)s::vector
    LIMIT %(limit)s
"""


@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    content: str
    score: float
    source_id: str


def search(org_id: str, query: str, top_k: int = 6) -> list[RetrievedChunk]:
    """Top-k chunks da org por score hibrido (busca vetorial + rerank lexical)."""
    settings = get_settings()
    top_k = max(1, top_k)

    query_vector = get_embedding_provider(settings).embed([query])[0]
    rows = db.fetch_all(
        _SEARCH_SQL,
        {
            "vec": db.vector_literal(query_vector),
            "org_id": org_id,
            "limit": top_k * CANDIDATE_MULTIPLIER,
        },
    )

    reranked = [
        RetrievedChunk(
            content=content,
            score=round(
                VECTOR_WEIGHT * clamp01(float(cosine)) + KEYWORD_WEIGHT * keyword_overlap(query, content),
                6,
            ),
            source_id=source_id,
        )
        for content, source_id, cosine in rows
    ]
    reranked.sort(key=lambda chunk: chunk.score, reverse=True)
    return reranked[:top_k]
