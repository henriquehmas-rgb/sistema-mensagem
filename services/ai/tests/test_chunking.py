"""Chunking: tamanhos, overlap e respeito a paragrafos."""

from __future__ import annotations

import pytest

from src.ingest import chunk_text

CHUNK_SIZE = 200
OVERLAP = 40
SEPARATOR = "\n\n"


def test_empty_text_returns_no_chunks() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n\n  ") == []


def test_short_text_is_single_chunk() -> None:
    text = "Um paragrafo curto sobre a politica de trocas."
    assert chunk_text(text, chunk_size=CHUNK_SIZE, overlap=OVERLAP) == [text]


def test_small_paragraphs_are_joined_in_one_chunk() -> None:
    text = "Primeiro paragrafo.\n\nSegundo paragrafo.\n\nTerceiro paragrafo."
    chunks = chunk_text(text, chunk_size=CHUNK_SIZE, overlap=OVERLAP)
    assert chunks == ["Primeiro paragrafo.\n\nSegundo paragrafo.\n\nTerceiro paragrafo."]


def test_long_text_respects_max_size_and_overlap() -> None:
    paragraphs = [f"Paragrafo {i}: " + ("conteudo relevante " * 6).strip() for i in range(30)]
    text = "\n\n".join(paragraphs)

    chunks = chunk_text(text, chunk_size=CHUNK_SIZE, overlap=OVERLAP)

    assert len(chunks) > 1
    max_len = CHUNK_SIZE + OVERLAP + len(SEPARATOR)
    assert all(len(chunk) <= max_len for chunk in chunks)
    # Overlap: cada chunk (apos o primeiro) comeca com o sufixo do anterior.
    for previous, current in zip(chunks, chunks[1:]):
        assert current.startswith(previous[-OVERLAP:])


def test_paragraph_longer_than_chunk_size_is_split() -> None:
    text = "x" * (CHUNK_SIZE * 3 + 17)
    chunks = chunk_text(text, chunk_size=CHUNK_SIZE, overlap=OVERLAP)
    assert len(chunks) >= 3
    max_len = CHUNK_SIZE + OVERLAP + len(SEPARATOR)
    assert all(len(chunk) <= max_len for chunk in chunks)
    # Nenhum conteudo perdido: total de 'x' >= tamanho original (overlap duplica chars).
    assert sum(chunk.count("x") for chunk in chunks) >= len(text)


def test_invalid_params_raise() -> None:
    with pytest.raises(ValueError):
        chunk_text("abc", chunk_size=0, overlap=0)
    with pytest.raises(ValueError):
        chunk_text("abc", chunk_size=100, overlap=100)
