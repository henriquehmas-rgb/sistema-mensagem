"""POST /memory/summarize — funde a memoria de longo prazo do contato com fatos novos.

CONTRACTS §15. Fail-safe ABSOLUTO: qualquer erro (LLM, timeout, parsing) retorna
200 com ``summary=existing_summary`` — o valor ORIGINAL recebido no payload,
NUNCA alterado por falha — NUNCA propaga excecao para o chamador (api NestJS).
Isso garante que uma falha no provedor de LLM jamais apaga a memoria de um
contato (o processor da api grava exatamente o `summary` devolvido aqui).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter

from ..config import get_settings
from ..handoff import detect_sensitive_data
from ..llm import ChatMessage, get_chat_provider
from ..llm.executor import generate_with_timeout
from ..llm.prompts import build_memory_prompt
from ..schemas import MemoryMessageIn, MemorySummarizeRequest, MemorySummarizeResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["memory"])

_SENSITIVE_PLACEHOLDER = "[dado sensível removido]"
# Fronteiras de frase preferidas para o corte de truncamento (§15: "corte em
# fronteira de frase se possivel").
_SENTENCE_BOUNDARIES = (". ", "! ", "? ", ".\n", "!\n", "?\n")


def _scrub_sensitive_messages(messages: list[MemoryMessageIn]) -> list[ChatMessage]:
    """Remove dado sensivel de pagamento/documento ANTES de qualquer mensagem chegar ao LLM.

    Reaproveita a MESMA heuristica de deteccao do handoff (`detect_sensitive_data`,
    `handoff.py`) — nao duplicamos regex aqui. Usa a checagem DEDICADA (nao
    `detect_handoff`), que nao depende da ordem de prioridade das regras de
    handoff: uma mensagem que tambem contenha outro gatilho (ex.: "cancelar")
    ainda assim tem o CPF/cartao corretamente removido. Isso e defesa em
    profundidade: o system prompt (`build_memory_prompt`) ja instrui o LLM a
    nunca reter esse tipo de dado, mas a mensagem nem chega a ser exposta ao
    provedor.
    """
    scrubbed: list[ChatMessage] = []
    for message in messages:
        content = message.content
        if detect_sensitive_data(content) is not None:
            content = _SENSITIVE_PLACEHOLDER
        scrubbed.append({"role": message.role, "content": content})
    return scrubbed


def _truncate_summary(text: str, max_chars: int | None = None) -> str:
    """Trunca com seguranca para caber em `max_chars`, preferindo fronteira de frase.

    `max_chars` (default: `get_settings().memory_summary_max_chars`, fonte
    UNICA do cap ~1500, compartilhada com o texto do prompt em
    `llm/prompts.py::build_memory_prompt`) — nao re-chama o LLM
    recursivamente (aceitavel para o MVP; ver nota no CONTRACTS §15).
    """
    if max_chars is None:
        max_chars = get_settings().memory_summary_max_chars
    text = text.strip()
    if len(text) <= max_chars:
        return text

    window = text[:max_chars]
    boundary = max((window.rfind(sep) for sep in _SENTENCE_BOUNDARIES), default=-1)
    if boundary >= max_chars * 0.5:
        return window[: boundary + 1].strip()

    space = window.rfind(" ")
    if space >= max_chars * 0.5:
        return window[:space].rstrip() + "…"

    return window.rstrip() + "…"


def _pipeline(payload: MemorySummarizeRequest) -> MemorySummarizeResponse:
    existing_summary = payload.existing_summary

    # (a) Sem mensagens novas: nada a fundir — nao gasta chamada de LLM.
    if not payload.messages:
        return MemorySummarizeResponse(summary=existing_summary)

    # (b) Blinda o conteudo enviado ao LLM + monta o prompt de fusao.
    safe_messages = _scrub_sensitive_messages(payload.messages)
    system = build_memory_prompt(existing_summary)

    # (c) LLM (mesmo provider/config de /reply, incluindo mock deterministico)
    # via o executor COMPARTILHADO com timeout rigido.
    provider = get_chat_provider()
    try:
        raw_summary = generate_with_timeout(
            provider, safe_messages, system, timeout=get_settings().llm_timeout_seconds
        )
    except TimeoutError:
        logger.warning("LLM timeout em /memory/summarize: org=%s", payload.org_id)
        return MemorySummarizeResponse(summary=existing_summary)
    except Exception:
        logger.exception("LLM falhou em /memory/summarize: org=%s", payload.org_id)
        return MemorySummarizeResponse(summary=existing_summary)

    fused = (raw_summary or "").strip()
    if not fused:
        return MemorySummarizeResponse(summary=existing_summary)

    # (d) Truncamento seguro (~1500 chars), sem re-chamar o LLM.
    return MemorySummarizeResponse(summary=_truncate_summary(fused))


@router.post("/memory/summarize", response_model=MemorySummarizeResponse)
def summarize_memory(payload: MemorySummarizeRequest) -> MemorySummarizeResponse:
    try:
        return _pipeline(payload)
    except Exception:  # noqa: BLE001 — fail-safe absoluto: nunca apaga memoria
        logger.exception("pipeline /memory/summarize falhou: org=%s", payload.org_id)
        return MemorySummarizeResponse(summary=payload.existing_summary)
