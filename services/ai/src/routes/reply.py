"""POST /reply — pipeline RAG com guardrails e deteccao de handoff.

Fail-safe absoluto: qualquer erro (DB, LLM, timeout) retorna 200 com
``handoff=true`` — NUNCA propaga excecao para o chamador (api NestJS).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter

from .. import retrieval
from ..config import get_settings
from ..handoff import HEURISTIC_HANDOFF_CONFIDENCE, detect_handoff, parse_llm_reply
from ..llm import ChatMessage, get_chat_provider
from ..llm.executor import generate_with_timeout
from ..llm.prompts import build_system_prompt
from ..schemas import ReplyRequest, ReplyResponse
from ..textutils import clamp01

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reply"])

_MAX_HISTORY_MESSAGES = 10
_LLM_HANDOFF_CONFIDENCE = 0.8


def _handoff(reason: str, confidence: float = HEURISTIC_HANDOFF_CONFIDENCE) -> ReplyResponse:
    return ReplyResponse(
        reply=None,
        handoff=True,
        handoff_reason=reason,
        confidence=confidence,
        sources=[],
    )


def _pipeline(payload: ReplyRequest) -> ReplyResponse:
    question = next(
        (message.content for message in reversed(payload.messages) if message.role == "user"),
        None,
    )
    if not question or not question.strip():
        return _handoff("mensagem_do_usuario_ausente", confidence=0.0)

    # (a) Heuristica pt-BR PRE-LLM — handoff sem gastar tokens.
    heuristic_reason = detect_handoff(question)
    if heuristic_reason:
        return _handoff(heuristic_reason)

    # (b) Busca semantica interna (mesma logica do POST /query).
    chunks = retrieval.search(payload.org_id, question, top_k=get_settings().retrieval_top_k)
    if not chunks:
        return _handoff("sem_contexto_na_base_de_conhecimento", confidence=0.0)

    # (c) System prompt com guardrails + contexto + memória de longo prazo
    # do contato (CONTRACTS §15) — bloco distinto, rotulado como referência.
    contact_name = payload.contact.name if payload.contact else None
    memory_summary = payload.contact.memory_summary if payload.contact else None
    system = build_system_prompt(
        chunks=[chunk.content for chunk in chunks],
        contact_name=contact_name,
        memory_summary=memory_summary,
    )

    # (d) LLM com timeout rigido de 30s.
    history: list[ChatMessage] = [
        {"role": message.role, "content": message.content}
        for message in payload.messages
        if message.role in ("user", "assistant")
    ][-_MAX_HISTORY_MESSAGES:]

    provider = get_chat_provider()
    try:
        raw_reply = generate_with_timeout(
            provider, history, system, timeout=get_settings().llm_timeout_seconds
        )
    except TimeoutError:
        logger.warning("LLM timeout: conversation=%s", payload.conversation_id)
        return _handoff("tempo_limite_do_llm_excedido", confidence=0.0)
    except Exception:
        logger.exception("LLM falhou: conversation=%s", payload.conversation_id)
        return _handoff("falha_no_provedor_llm", confidence=0.0)

    # (e) Parse do token [HANDOFF] / resposta vazia.
    is_handoff, reply_text, handoff_reason = parse_llm_reply(raw_reply)
    if is_handoff:
        return _handoff(
            handoff_reason or "contexto_insuficiente",
            confidence=_LLM_HANDOFF_CONFIDENCE,
        )

    sources: list[str] = []
    for chunk in chunks:
        if chunk.source_id not in sources:
            sources.append(chunk.source_id)

    return ReplyResponse(
        reply=reply_text,
        handoff=False,
        handoff_reason=None,
        confidence=clamp01(max(chunk.score for chunk in chunks)),
        sources=sources,
    )


@router.post("/reply", response_model=ReplyResponse)
def create_reply(payload: ReplyRequest) -> ReplyResponse:
    try:
        return _pipeline(payload)
    except Exception:  # noqa: BLE001 — fail-safe: nunca propagar erro
        logger.exception("pipeline /reply falhou: conversation=%s", payload.conversation_id)
        return _handoff("erro_interno_no_servico_de_ia", confidence=0.0)
