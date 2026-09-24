"""Utilitarios de texto pt-BR: normalizacao, tokenizacao e overlap de palavras-chave."""

from __future__ import annotations

import re
import unicodedata

_WORD_RE = re.compile(r"[a-z0-9]{3,}")

# Stopwords pt-BR (apenas tokens com 3+ chars — o tokenizador descarta menores).
_STOPWORDS = frozenset(
    {
        "que", "com", "por", "para", "uma", "umas", "uns", "dos", "das", "nos", "nas",
        "como", "qual", "quais", "este", "esta", "isto", "esse", "essa", "isso",
        "aquele", "aquela", "seu", "sua", "seus", "suas", "meu", "minha", "voce",
        "voces", "tem", "ter", "ser", "sao", "esta", "estao", "foi", "mais", "menos",
        "muito", "muita", "nao", "sim", "pelo", "pela", "sobre", "entre", "tambem",
        "onde", "quando", "quem", "aos", "mas", "porque", "pois", "sem", "ate", "ja",
        "vai", "vou", "pode", "podem", "fazer", "faz",
    }
)


def normalize(text: str) -> str:
    """Minusculas + remocao de acentos (NFD sem combining marks)."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def tokenize(text: str) -> set[str]:
    """Conjunto de palavras significativas (normalizadas, sem stopwords)."""
    return {word for word in _WORD_RE.findall(normalize(text)) if word not in _STOPWORDS}


def keyword_overlap(query: str, content: str) -> float:
    """Fração das palavras da pergunta cobertas, tolerando flexão pt-BR.

    O prefixo mínimo de cinco caracteres cobre casos como ``atendimento`` /
    ``atende`` sem transformar palavras curtas e genéricas em equivalentes.
    """
    query_words = tokenize(query)
    if not query_words:
        return 0.0
    content_words = tokenize(content)
    matches = sum(
        1
        for query_word in query_words
        if any(
            query_word == content_word
            or (
                len(query_word) >= 5
                and len(content_word) >= 5
                and query_word[:5] == content_word[:5]
            )
            for content_word in content_words
        )
    )
    return matches / len(query_words)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))
