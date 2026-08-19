"""Deteccao de handoff (pt-BR) e parse do token [HANDOFF] do LLM."""

from __future__ import annotations

import re

from .textutils import normalize

HANDOFF_TOKEN = "[HANDOFF]"
HEURISTIC_HANDOFF_CONFIDENCE = 0.95

# Motivos especificos de dado sensivel (pagamento/documento) — exportados para
# que outros modulos (ex.: routes/memory.py) reaproveitem a MESMA heuristica de
# deteccao em vez de duplicar regex, ao decidir o que nao pode ser retido em
# memoria (CONTRACTS §15: "NUNCA reter dado sensível de pagamento/documento").
SENSITIVE_PAYMENT_DATA_REASON = "dados_sensiveis_pagamento"
SENSITIVE_DOCUMENT_DATA_REASON = "dados_sensiveis_documento"

_PAYMENT_DATA_PATTERN = re.compile(
    r"\bcvv\b|\bcvc\b"
    r"|numero\s+do\s+(meu\s+)?cartao"
    r"|senha\s+do\s+(meu\s+)?cartao"
    r"|dados\s+do\s+(meu\s+)?cartao"
    r"|cartao\s+de\s+credito\s+(e|eh)?\s*:?\s*\d"
    r"|(?:\d[\s.\-]?){13,18}\d"  # sequencias de 14-19 digitos (cartao)
)

_DOCUMENT_DATA_PATTERN = re.compile(
    r"\bcpf\b"
    r"|\brg\b"
    r"|documento\s+de\s+identidade"
    r"|carteira\s+de\s+identidade"
    r"|numero\s+do\s+(meu\s+)?documento"
    r"|numero\s+da\s+(minha\s+)?identidade"
    r"|(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)"  # CPF: 11 digitos, formatado ou nao
)

# Checagem DEDICADA de dado sensivel (pagamento/documento), independente da
# ordem/prioridade de `_RULES` abaixo (usada por `detect_handoff` só para
# escolher o MOTIVO de handoff quando varias regras colidem). `routes/memory.py`
# usa esta funcao — nao `detect_handoff` — para decidir o que blindar do LLM,
# assim uma mensagem como "Quero cancelar, meu CPF é 123.456.789-00" tem o CPF
# sempre removido mesmo que "cancelamento" tenha prioridade como motivo de
# handoff.
_SENSITIVE_DATA_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (SENSITIVE_PAYMENT_DATA_REASON, _PAYMENT_DATA_PATTERN),
    (SENSITIVE_DOCUMENT_DATA_REASON, _DOCUMENT_DATA_PATTERN),
)


def detect_sensitive_data(text: str) -> str | None:
    """Retorna o motivo de dado sensivel (pagamento OU documento) ou None.

    Verifica SOMENTE os padroes de dado sensivel, sem a prioridade das demais
    regras de handoff — ver nota acima.
    """
    normalized = normalize(text)
    for reason, pattern in _SENSITIVE_DATA_RULES:
        if pattern.search(normalized):
            return reason
    return None


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
    (SENSITIVE_PAYMENT_DATA_REASON, _PAYMENT_DATA_PATTERN),
    (SENSITIVE_DOCUMENT_DATA_REASON, _DOCUMENT_DATA_PATTERN),
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
