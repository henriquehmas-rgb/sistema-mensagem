"""Deteccao de handoff (pt-BR) e parse do token [HANDOFF] do LLM."""

from __future__ import annotations

import re

from .textutils import normalize

HANDOFF_TOKEN = "[HANDOFF]"
HEURISTIC_HANDOFF_CONFIDENCE = 0.95

# Regras avaliadas em ordem sobre o texto NORMALIZADO (minusculas, sem acentos).
_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "pedido_de_atendimento_humano",
        re.compile(
            r"\batendente\b"
            r"|\bser\s+humano\b"
            r"|pessoa\s+de\s+verdade"
            r"|alguem\s+de\s+verdade"
            r"|atendimento\s+humano"
            r"|suporte\s+humano"
            r"|(falar|conversar|atendid[oa])\s+(com|por)\s+(um[a]?\s+|o\s+|a\s+)?"
            r"(humano|atendente|pessoa|gente|gerente|responsavel)"
            r"|nao\s+quero\s+falar\s+com\s+(rob[oô]?|bot|maquina|ia)"
        ),
    ),
    (
        "cancelamento",
        re.compile(r"\bcancelar\b|\bcancelamento\b|\bcancela\b|\bcancele\b"),
    ),
    (
        "reclamacao_grave",
        re.compile(
            r"\bprocon\b|\breclame\s*aqui\b|\bprocessar\b|\bprocesso\s+judicial\b"
            r"|\badvogad[oa]s?\b|\binaceitavel\b|\babsurdo\b|\bvergonha\b"
            r"|\brevoltad[oa]\b|\bindignad[oa]\b|\bpessim[oa]\b"
        ),
    ),
    (
        "linguagem_ofensiva",
        re.compile(
            r"\bmerda\b|\bporra\b|\bcaralho\b|\bput[ao]\b|\bfoda[-\s]?se\b"
            r"|\bfodid[oa]\b|\bdesgraca\b|\bvai\s+se\s+f|\bvsf\b|\bpqp\b|\bfdp\b"
        ),
    ),
    (
        "dados_sensiveis_pagamento",
        re.compile(
            r"\bcvv\b|\bcvc\b"
            r"|numero\s+do\s+(meu\s+)?cartao"
            r"|senha\s+do\s+(meu\s+)?cartao"
            r"|dados\s+do\s+(meu\s+)?cartao"
            r"|cartao\s+de\s+credito\s+(e|eh)?\s*:?\s*\d"
            r"|(?:\d[\s.\-]?){13,18}\d"  # sequencias de 14-19 digitos (cartao)
        ),
    ),
)


def detect_handoff(text: str) -> str | None:
    """Retorna o motivo do handoff (ou None) via heuristica pre-LLM em pt-BR."""
    normalized = normalize(text)
    for reason, pattern in _RULES:
        if pattern.search(normalized):
            return reason
    return None


def parse_llm_reply(raw: str | None) -> tuple[bool, str | None, str | None]:
    """Interpreta a saida do LLM.

    Retorna ``(handoff, reply, handoff_reason)``:
    - resposta vazia → handoff (``resposta_vazia``);
    - contem o token ``[HANDOFF]`` (case-insensitive) → handoff, motivo = texto
      apos o token (ou ``contexto_insuficiente``);
    - caso contrario → resposta normal.
    """
    text = (raw or "").strip()
    if not text:
        return True, None, "resposta_vazia"

    index = text.upper().find(HANDOFF_TOKEN)
    if index != -1:
        reason = text[index + len(HANDOFF_TOKEN) :].strip(" \t\n-—:.,;")
        return True, None, reason or "contexto_insuficiente"

    return False, text, None
