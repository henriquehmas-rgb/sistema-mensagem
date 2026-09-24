"""Compactação auxiliar segura antes do modelo principal.

O auxiliar resume somente o trecho antigo de conversas longas. Mensagens
recentes permanecem literais e fontes autoritativas continuam fora do resumo.
Qualquer falha é fail-open para o histórico limitado que já era usado.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
import logging

from ..config import Settings
from . import ChatMessage, get_chat_provider
from .executor import generate_with_timeout

logger = logging.getLogger(__name__)

RECENT_MESSAGES = 6
FALLBACK_MESSAGES = 10
MAX_OLD_MESSAGES_FOR_AUXILIARY = 24
MIN_MESSAGES_TO_COMPACT = 11
MAX_AUXILIARY_CHARS = 1200

_STRING_FIELDS = ("objetivo_cliente", "setor")
_LIST_FIELDS = (
    "problemas_confirmados", "informacoes_fornecidas", "procedimentos_realizados",
    "resultados", "pendencias", "restricoes", "perguntas_em_aberto",
)
_ALLOWED_FIELDS = frozenset((*_STRING_FIELDS, *_LIST_FIELDS))

_AUXILIARY_SYSTEM = """Você compacta SOMENTE o trecho antigo de uma conversa de atendimento.
Retorne apenas JSON válido, sem markdown, exatamente com estes campos:
{"objetivo_cliente":"","setor":"","problemas_confirmados":[],
"informacoes_fornecidas":[],"procedimentos_realizados":[],"resultados":[],
"pendencias":[],"restricoes":[],"perguntas_em_aberto":[]}
Use apenas fatos explícitos nas mensagens recebidas. Não conclua, não autorize ações, não crie
valores, aprovações, respostas ou decisões de skill/GAP. Dúvidas devem permanecer como pendências.
O campo setor só pode ser financeiro, suporte, vendas ou vazio. Seja conciso."""


@dataclass(frozen=True)
class HistoryContext:
    messages: list[ChatMessage]
    auxiliary_state: str | None = None
    compacted: bool = False
    original_count: int = 0
    retained_count: int = 0


def _validate_auxiliary_state(raw: str) -> str | None:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or set(payload) != _ALLOWED_FIELDS:
        return None
    clean: dict[str, str | list[str]] = {}
    for field in _STRING_FIELDS:
        value = payload[field]
        if not isinstance(value, str):
            return None
        value = " ".join(value.split()).strip()
        if field == "setor" and value not in {"", "financeiro", "suporte", "vendas"}:
            return None
        clean[field] = value[:180]
    for field in _LIST_FIELDS:
        values = payload[field]
        if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
            return None
        clean[field] = [" ".join(item.split()).strip()[:220] for item in values[:6] if item.strip()]
    canonical = json.dumps(clean, ensure_ascii=False, separators=(",", ":"))
    return canonical if len(canonical) <= MAX_AUXILIARY_CHARS else None


def prepare_history_context(settings: Settings, messages: list[ChatMessage]) -> HistoryContext:
    """Retorna o contexto primário econômico sem confiar fatos ao auxiliar."""
    fallback = messages[-FALLBACK_MESSAGES:]
    if not settings.ai_auxiliary_provider or len(messages) < MIN_MESSAGES_TO_COMPACT:
        return HistoryContext(fallback, original_count=len(messages), retained_count=len(fallback))
    recent = messages[-RECENT_MESSAGES:]
    old = messages[:-RECENT_MESSAGES][-MAX_OLD_MESSAGES_FOR_AUXILIARY:]
    try:
        raw = generate_with_timeout(
            get_chat_provider(settings, role="auxiliary"),
            old,
            _AUXILIARY_SYSTEM,
            timeout=min(settings.llm_timeout_seconds, 12.0),
        )
    except Exception:  # auxiliar nunca pode derrubar o atendimento
        logger.exception("Compactação auxiliar falhou; usando histórico de fallback")
        raw = ""
    auxiliary_state = _validate_auxiliary_state(raw)
    if not auxiliary_state:
        logger.warning("Compactação auxiliar inválida; usando histórico de fallback")
        return HistoryContext(fallback, original_count=len(messages), retained_count=len(fallback))
    logger.info(
        "Histórico compactado: original_messages=%d summarized_messages=%d retained_messages=%d",
        len(messages), len(old), len(recent),
    )
    return HistoryContext(
        recent, auxiliary_state=auxiliary_state, compacted=True,
        original_count=len(messages), retained_count=len(recent),
    )
