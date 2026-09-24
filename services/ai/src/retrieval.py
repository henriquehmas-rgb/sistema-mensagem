"""Busca semantica em knowledge_chunks (pgvector) com rerank hibrido.

Score hibrido = 0.75 * similaridade_cosseno + 0.25 * overlap de palavras-chave.
TODA query filtra por org_id (multitenancy obrigatoria — CONTRACTS §3/§11).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Iterable

from . import db
from .config import get_settings
from .embeddings import MockEmbeddings, embedding_provider_fingerprint, get_embedding_provider
from .textutils import clamp01, keyword_overlap, tokenize

VECTOR_WEIGHT = 0.75
KEYWORD_WEIGHT = 0.25
# A source may be split into many chunks. Fetch enough candidates for the
# reranker to compare newer, narrower sources instead of letting one long
# document fill the whole candidate window.
# Catálogos factuais podem ter muitos trechos. Uma janela maior dá espaço para
# o reranqueamento diverso recuperar também o artigo específico do caso
# (cobertura, desconto, proposta), sem retirar o catálogo da evidência.
CANDIDATE_MULTIPLIER = 12

_SEARCH_SQL = """
    SELECT kc.content, kc.source_id, 1 - (kc.embedding <=> %(vec)s::vector) AS score,
           ks.type::text, ks.meta
    FROM knowledge_chunks kc
    JOIN knowledge_sources ks ON ks.id = kc.source_id AND ks.org_id = kc.org_id
    WHERE kc.org_id = %(org_id)s
      AND ks.meta->>'embeddingProvider' = %(embedding_provider)s
      AND ks.status = 'READY'
      AND (
        %(departments)s::text[] IS NULL
        OR coalesce(ks.meta->>'department', '') = ANY(%(departments)s::text[])
      )
    ORDER BY kc.embedding <=> %(vec)s::vector
    LIMIT %(limit)s
"""

# A busca vetorial é a fonte principal de candidatos, mas um catálogo longo
# pode ficar fora da janela semântica mesmo quando a pergunta contém um termo
# literal importante (por exemplo, "planos"). A janela lexical abaixo entra
# apenas como complemento e mantém exatamente os mesmos filtros de tenant,
# provedor de embeddings e fonte pronta.
_LEXICAL_CANDIDATE_SQL = """
    SELECT kc.content, kc.source_id, 0.0 AS score, ks.type::text, ks.meta
    FROM knowledge_chunks kc
    JOIN knowledge_sources ks ON ks.id = kc.source_id AND ks.org_id = kc.org_id
    WHERE kc.org_id = %(org_id)s
      AND ks.meta->>'embeddingProvider' = %(embedding_provider)s
      AND ks.status = 'READY'
      AND (
        %(departments)s::text[] IS NULL
        OR coalesce(ks.meta->>'department', '') = ANY(%(departments)s::text[])
      )
      AND kc.content ILIKE ANY(%(patterns)s)
    LIMIT %(limit)s
"""

_MOCK_SEARCH_SQL = """
    SELECT kc.content, kc.source_id, 0.0 AS score, ks.type::text, ks.meta
    FROM knowledge_chunks kc
    JOIN knowledge_sources ks ON ks.id = kc.source_id AND ks.org_id = kc.org_id
    WHERE kc.org_id = %(org_id)s
      AND ks.meta->>'embeddingProvider' = %(embedding_provider)s
      AND ks.status = 'READY'
      AND (
        %(departments)s::text[] IS NULL
        OR coalesce(ks.meta->>'department', '') = ANY(%(departments)s::text[])
      )
    ORDER BY kc.created_at DESC
    LIMIT %(limit)s
"""

MOCK_CANDIDATE_LIMIT = 500


@dataclass(frozen=True, slots=True)
class RetrievedChunk:
    content: str
    score: float
    source_id: str
    source_type: str = "TEXT"
    source_meta: dict[str, Any] = field(default_factory=dict)

    @property
    def authority(self) -> int:
        value = self.source_meta.get("authority", 50)
        try:
            return max(0, min(100, int(value)))
        except (TypeError, ValueError):
            return 50

    @property
    def is_current(self) -> bool:
        valid_until = self.source_meta.get("validUntil") or self.source_meta.get("valid_until")
        if not valid_until:
            return True
        try:
            parsed = datetime.fromisoformat(str(valid_until).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed >= datetime.now(UTC)
        except (TypeError, ValueError):
            # Metadado invalido nao deve transformar uma fonte em verdade atual.
            return False


def search(
    org_id: str,
    query: str,
    top_k: int = 6,
    allowed_departments: Iterable[str] | None = None,
) -> list[RetrievedChunk]:
    """Top-k chunks da org por score hibrido (busca vetorial + rerank lexical).

    ``allowed_departments`` limita os candidatos ainda no banco. Isso impede
    que textos aprovados de outro setor ocupem a janela vetorial antes do
    isolamento aplicado pela rota de resposta.
    """
    settings = get_settings()
    top_k = max(1, top_k)
    departments = sorted({str(item).strip() for item in (allowed_departments or ()) if str(item).strip()})

    embedding_provider = get_embedding_provider(settings)
    fingerprint = embedding_provider_fingerprint(settings)
    if isinstance(embedding_provider, MockEmbeddings):
        # O embedding mock e pseudoaleatorio, portanto nao pode selecionar os
        # candidatos. Em homologacao fazemos uma varredura lexical limitada e
        # deterministica; embeddings reais continuam usando pgvector abaixo.
        rows = db.fetch_all(
            _MOCK_SEARCH_SQL,
            {
                    "org_id": org_id,
                    "embedding_provider": fingerprint,
                    "departments": departments or None,
                    "limit": MOCK_CANDIDATE_LIMIT,
            },
        )
        patterns = _lexical_patterns(query)
        if patterns:
            lexical_rows = db.fetch_all(
                _LEXICAL_CANDIDATE_SQL,
                {
                    "org_id": org_id,
                    "embedding_provider": fingerprint,
                    "departments": departments or None,
                    "patterns": patterns,
                    "limit": top_k * CANDIDATE_MULTIPLIER,
                },
            )
            # A mesma linha pode ter sido selecionada pelas duas estratégias.
            # Mantemos uma cópia para o rerank, sem depender de id interno.
            seen = {(row[0], row[1]) for row in rows}
            rows.extend(row for row in lexical_rows if (row[0], row[1]) not in seen)
    else:
        query_vector = embedding_provider.embed([query])[0]
        rows = db.fetch_all(
            _SEARCH_SQL,
            {
                "vec": db.vector_literal(query_vector),
                "org_id": org_id,
                "embedding_provider": fingerprint,
                "departments": departments or None,
                "limit": top_k * CANDIDATE_MULTIPLIER,
            },
        )

    reranked: list[RetrievedChunk] = []
    for row in rows:
        # Aceita o formato historico de tres colunas usado por adaptadores/testes.
        content, source_id, cosine = row[:3]
        source_type = row[3] if len(row) > 3 else "TEXT"
        meta = row[4] if len(row) > 4 else {}
        reranked.append(
            RetrievedChunk(
                content=content,
                score=_relevance_score(query, content, float(cosine)),
                source_id=source_id,
                source_type=source_type,
                source_meta=meta if isinstance(meta, dict) else {},
            )
        )
    reranked = [chunk for chunk in reranked if chunk.is_current]
    # Autoridade melhora a posicao sem permitir que uma fonte irrelevante vença
    # apenas por ter prioridade administrativa maior.
    reranked.sort(
        key=lambda chunk: chunk.score * (0.8 + 0.2 * chunk.authority / 100),
        reverse=True,
    )
    return _diverse_sources(reranked, top_k)


def _lexical_patterns(query: str) -> list[str]:
    """Padrões curtos e significativos para a janela lexical complementar.

    Cinco caracteres preservam a tolerância já usada no reranker para flexões
    como ``plano``/``planos``, sem ampliar a busca com palavras genéricas.
    """
    return [f"%{word[:5]}%" for word in sorted(tokenize(query)) if len(word) >= 4][:12]


def _diverse_sources(chunks: list[RetrievedChunk], top_k: int) -> list[RetrievedChunk]:
    """Prefer one best chunk per source, then fill remaining positions.

    This preserves a useful fallback when there are fewer distinct sources than
    requested, while preventing a lengthy protocol from crowding out specific,
    approved guidance in the normal case.
    """
    selected: list[RetrievedChunk] = []
    deferred: list[RetrievedChunk] = []
    seen_sources: set[str] = set()
    for chunk in chunks:
        if chunk.source_id in seen_sources:
            deferred.append(chunk)
            continue
        selected.append(chunk)
        seen_sources.add(chunk.source_id)
        if len(selected) == top_k:
            return selected
    selected.extend(deferred[: max(0, top_k - len(selected))])
    return selected[:top_k]


def _relevance_score(query: str, content: str, cosine: float) -> float:
    """Combina semantica e texto sem penalizar uma correspondencia literal forte.

    Em homologacao, ``MockEmbeddings`` e deterministico, mas propositalmente nao
    semantico. O maximo com o overlap lexical mantem o RAG funcional nesse modo;
    com embeddings reais, o score hibrido continua cobrindo sinonimos e parafrases.
    """
    lexical = keyword_overlap(query, content)
    hybrid = VECTOR_WEIGHT * clamp01(cosine) + KEYWORD_WEIGHT * lexical
    return round(max(hybrid, lexical), 6)
