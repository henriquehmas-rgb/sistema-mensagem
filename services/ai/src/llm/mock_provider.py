"""Provedor de chat MOCK deterministico — dev/testes sem chave de API.

Se algum bloco do CONTEXTO tem match forte com a pergunta (overlap lexical),
responde com base no melhor bloco; caso contrario devolve o token [HANDOFF].
"""

from __future__ import annotations

import textwrap

from ..handoff import HANDOFF_TOKEN
from ..textutils import tokenize
from .base import ChatMessage, ChatProvider
from .prompts import extract_context_blocks

_MIN_COMMON_WORDS = 2
_MIN_OVERLAP_RATIO = 0.3
_SNIPPET_WIDTH = 240


class MockChat(ChatProvider):
    name = "mock"

    def generate(self, messages: list[ChatMessage], system: str) -> str:
        question = next(
            (message["content"] for message in reversed(messages) if message["role"] == "user"),
            "",
        )
        question_words = tokenize(question)
        best_block: str | None = None
        best_key: tuple[int, float] = (0, 0.0)

        for block in extract_context_blocks(system):
            block_words = tokenize(block)
            common = len(question_words & block_words)
            ratio = common / len(question_words) if question_words else 0.0
            if (common, ratio) > best_key:
                best_key = (common, ratio)
                best_block = block

        common, ratio = best_key
        if best_block and common >= _MIN_COMMON_WORDS and ratio >= _MIN_OVERLAP_RATIO:
            snippet = textwrap.shorten(best_block, width=_SNIPPET_WIDTH, placeholder="…")
            return f"Com base nas informações disponíveis: {snippet}"
        return f"{HANDOFF_TOKEN} contexto_insuficiente_para_responder"
