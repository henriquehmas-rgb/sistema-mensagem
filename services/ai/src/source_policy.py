"""Politica deterministica de autoridade, atualidade e conflito entre fontes."""

from __future__ import annotations

import re
from collections.abc import Sequence

from .retrieval import RetrievedChunk

_SENSITIVE_FACT_QUERY = re.compile(
    r"\b(pre[cç]o|valor|prazo|vencimento|desconto|taxa|velocidade|quantos?|quantidade)\b",
    re.IGNORECASE,
)
_NUMBER = re.compile(r"(?<!\w)(?:R\$\s*)?\d+(?:[.,]\d+)?(?:\s*%|\s*(?:dias?|horas?|meses?|mb|gb))?", re.IGNORECASE)


def conflicting_authoritative_facts(query: str, chunks: Sequence[RetrievedChunk]) -> bool:
    """Detecta divergencia factual objetiva sem pedir ao modelo que arbitre a verdade.

    A regra e propositalmente estreita: somente perguntas quantitativas e fontes com
    autoridade >= 70. Casos ambíguos seguem para revisão humana, nunca para escolha
    silenciosa do LLM.
    """
    if not _SENSITIVE_FACT_QUERY.search(query):
        return False
    facts: list[set[str]] = []
    for chunk in chunks:
        if chunk.authority < 70 or chunk.score < 0.6:
            continue
        values = {re.sub(r"\s+", "", item.lower()) for item in _NUMBER.findall(chunk.content)}
        if len(values) == 1:
            facts.append(values)
    return len(facts) >= 2 and any(left.isdisjoint(right) for i, left in enumerate(facts) for right in facts[i + 1 :])
