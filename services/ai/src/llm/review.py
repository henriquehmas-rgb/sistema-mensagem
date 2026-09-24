"""Revisao seletiva opcional de respostas por um segundo papel de modelo."""

from __future__ import annotations

from ..triage import TriageResult
from .base import ChatMessage, ChatProvider
from .executor import generate_with_timeout

_REVIEW_MARGIN = 0.1


def needs_model_review(triage: TriageResult, confidence: float, minimum: float) -> bool:
    """Evita revisar tudo: usa o revisor apenas perto do limiar ou em rotas sensiveis."""
    return confidence < min(1.0, minimum + _REVIEW_MARGIN) or triage.route_key in {
        "billing",
        "sales",
    }


def approve_reply(
    provider: ChatProvider,
    *,
    question: str,
    proposed_reply: str,
    trusted_context: str,
    timeout: float,
) -> bool:
    system = (
        "Revise uma resposta de atendimento usando somente o contexto confiavel. "
        "Responda exatamente APPROVE se todos os fatos estiverem sustentados e nenhuma promessa, "
        "desconto, prazo ou acao nao autorizada tiver sido criada. Caso contrario responda REJECT.\n\n"
        f"CONTEXTO_CONFIAVEL:\n{trusted_context[:12000]}"
    )
    messages: list[ChatMessage] = [
        {"role": "user", "content": f"PERGUNTA:\n{question}\n\nRESPOSTA_PROPOSTA:\n{proposed_reply}"}
    ]
    result = generate_with_timeout(provider, messages, system, timeout=timeout)
    return result.strip().upper() == "APPROVE"
