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
    """Fracao [0..1] das palavras-chave da query presentes no conteudo."""
    query_words = tokenize(query)
    if not query_words:
        return 0.0
    return len(query_words & tokenize(content)) / len(query_words)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))
