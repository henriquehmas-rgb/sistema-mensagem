"""POST /query — busca semantica com rerank hibrido (sempre filtrada por org_id)."""

from __future__ import annotations

from fastapi import APIRouter

from .. import retrieval
from ..schemas import ChunkResult, QueryRequest, QueryResponse

router = APIRouter(tags=["knowledge"])


@router.post("/query", response_model=QueryResponse)
def query_knowledge(payload: QueryRequest) -> QueryResponse:
    chunks = retrieval.search(payload.org_id, payload.query, top_k=payload.top_k)
    return QueryResponse(
        chunks=[
            ChunkResult(content=chunk.content, score=chunk.score, source_id=chunk.source_id)
            for chunk in chunks
        ]
    )
