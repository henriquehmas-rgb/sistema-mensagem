"""Provedor de chat MOCK deterministico — dev/testes sem chave de API.

Dois modos, distinguidos pelo marcador presente no system prompt:
- `/reply`: overlap lexical contra os blocos de CONTEXTO (RAG) — ver
  ``prompts.build_system_prompt``. Sem match forte, devolve o token [HANDOFF].
- `/memory/summarize`: funde o RESUMO_EXISTENTE com um resumo curto e
  deterministico das mensagens NOVAS do contato — ver
  ``prompts.build_memory_prompt``. Nunca faz chamada de rede.
"""

from __future__ import annotations

import re
import textwrap

from ..handoff import HANDOFF_TOKEN
from ..textutils import keyword_overlap, tokenize
from .base import ChatMessage, ChatProvider
from .prompts import MEMORY_SUMMARY_START, extract_context_blocks, extract_memory_summary

_MIN_COMMON_WORDS = 2
_MIN_OVERLAP_RATIO = 0.3
_SNIPPET_WIDTH = 240
_MEMORY_FACTS_WIDTH = 300


class MockChat(ChatProvider):
    name = "mock"

    def generate(self, messages: list[ChatMessage], system: str) -> str:
        if MEMORY_SUMMARY_START in system:
            return self._generate_memory_fusion(messages, system)
        return self._generate_reply(messages, system)

    @staticmethod
    def _generate_reply(messages: list[ChatMessage], system: str) -> str:
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
            if best_block is None or (common, ratio) > best_key:
                best_key = (common, ratio)
                best_block = block

        common, ratio = best_key
        # Os blocos recebidos aqui já passaram pelo corte de relevância do RAG.
        # No mock, não há compreensão semântica para fazer uma segunda decisão;
        # exigir outro overlap criava falsos negativos em flexões e paráfrases.
        if best_block:
            snippet = _focused_snippet(question, best_block)
            if "Nível de conversa: acolhedor" in system:
                return f"Entendo como isso pode ser desgastante. {snippet}"
            if "Nível de conversa: passo_a_passo" in system:
                return f"Vamos por etapas. {snippet}"
            return snippet
        return f"{HANDOFF_TOKEN} contexto_insuficiente_para_responder"

    @staticmethod
    def _generate_memory_fusion(messages: list[ChatMessage], system: str) -> str:
        """Fusao deterministica: RESUMO_EXISTENTE + frase curta com fatos NOVOS.

        So considera role == "user" — fatos ditos pelo PROPRIO contato, nunca o
        que o assistente respondeu. Sem fatos novos, devolve o resumo existente
        inalterado (a rota entende string vazia como "nada mudou").
        """
        existing = extract_memory_summary(system) or ""
        facts = [
            message["content"].strip()
            for message in messages
            if message.get("role") == "user" and message.get("content", "").strip()
        ]
        if not facts:
            return existing

        new_facts = textwrap.shorten(" ".join(facts), width=_MEMORY_FACTS_WIDTH, placeholder="…")
        if existing:
            return f"{existing} Novidades: {new_facts}"
        return f"Novidades: {new_facts}"


def _focused_snippet(question: str, block: str) -> str:
    """Retorna a frase mais relacionada, sem despejar o bloco inteiro do RAG."""
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", block) if part.strip()]
    best = max(sentences or [block], key=lambda sentence: keyword_overlap(question, sentence))
    return textwrap.shorten(best, width=_SNIPPET_WIDTH, placeholder="…")
