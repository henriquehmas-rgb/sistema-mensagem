"""Pipeline /reply: parse [HANDOFF], heuristica, RAG mock e fail-safe."""

from __future__ import annotations

import pytest

from src import retrieval
from src.handoff import parse_llm_reply
from src.retrieval import RetrievedChunk

AUTH_BODY_BASE = {
    "org_id": "org_1",
    "conversation_id": "conv_1",
    "contact": {"name": "Ana"},
}


# ---------------------------------------------------------------- parse_llm_reply
def test_parse_handoff_token_with_reason() -> None:
    handoff, reply, reason = parse_llm_reply("[HANDOFF] sem informacoes sobre precos")
    assert handoff is True
    assert reply is None
    assert reason == "sem informacoes sobre precos"


def test_parse_handoff_token_case_insensitive_and_default_reason() -> None:
    handoff, reply, reason = parse_llm_reply("  [handoff]  ")
    assert handoff is True
    assert reply is None
    assert reason == "contexto_insuficiente"


def test_parse_handoff_token_mid_text() -> None:
    handoff, _, _ = parse_llm_reply("Desculpe. [HANDOFF] fora de escopo")
    assert handoff is True


def test_parse_empty_reply_is_handoff() -> None:
    handoff, reply, reason = parse_llm_reply("")
    assert handoff is True
    assert reason == "resposta_vazia"
    handoff_none, _, _ = parse_llm_reply(None)
    assert handoff_none is True


def test_parse_normal_reply() -> None:
    handoff, reply, reason = parse_llm_reply("Olá! O prazo é de 3 dias úteis.")
    assert handoff is False
    assert reply == "Olá! O prazo é de 3 dias úteis."
    assert reason is None


# ------------------------------------------------------------------- endpoint
def _reply(client, auth_headers, message: str):
    body = {**AUTH_BODY_BASE, "messages": [{"role": "user", "content": message}]}
    return client.post("/reply", json=body, headers=auth_headers)


def test_heuristic_handoff_short_circuits(client, auth_headers) -> None:
    response = _reply(client, auth_headers, "quero falar com um atendente")
    assert response.status_code == 200
    body = response.json()
    assert body["handoff"] is True
    assert body["reply"] is None
    assert body["handoff_reason"] == "pedido_de_atendimento_humano"
    assert body["confidence"] == pytest.approx(0.95)
    assert body["sources"] == []


def test_reply_with_matching_context(client, auth_headers, monkeypatch) -> None:
    chunks = [
        RetrievedChunk(
            content="O prazo de entrega para São Paulo é de 3 dias úteis.",
            score=0.91,
            source_id="src_entregas",
        ),
        RetrievedChunk(
            content="Prazo de entrega: interior de São Paulo em até 5 dias úteis.",
            score=0.82,
            source_id="src_entregas",
        ),
    ]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6: chunks)

    response = _reply(client, auth_headers, "Qual o prazo de entrega para São Paulo?")
    assert response.status_code == 200
    body = response.json()
    assert body["handoff"] is False
    assert body["reply"].startswith("Com base nas informações disponíveis:")
    assert body["confidence"] == pytest.approx(0.91)
    assert body["sources"] == ["src_entregas"]


def test_reply_without_context_is_handoff(client, auth_headers, monkeypatch) -> None:
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6: [])
    response = _reply(client, auth_headers, "Qual o prazo de entrega?")
    body = response.json()
    assert body["handoff"] is True
    assert body["handoff_reason"] == "sem_contexto_na_base_de_conhecimento"


def test_reply_with_unrelated_context_returns_llm_handoff(client, auth_headers, monkeypatch) -> None:
    chunks = [
        RetrievedChunk(content="Política de trocas: 30 dias.", score=0.4, source_id="src_trocas")
    ]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6: chunks)
    response = _reply(client, auth_headers, "Vocês fazem instalação de ar condicionado?")
    body = response.json()
    assert body["handoff"] is True
    assert body["reply"] is None


def test_reply_never_propagates_errors(client, auth_headers, monkeypatch) -> None:
    def boom(org_id: str, query: str, top_k: int = 6):
        raise RuntimeError("db offline")

    monkeypatch.setattr(retrieval, "search", boom)
    response = _reply(client, auth_headers, "Qual o horário de funcionamento?")
    assert response.status_code == 200
    body = response.json()
    assert body["handoff"] is True
    assert body["handoff_reason"] == "erro_interno_no_servico_de_ia"
    assert body["confidence"] == 0.0


def test_reply_without_user_message_is_handoff(client, auth_headers) -> None:
    body = {**AUTH_BODY_BASE, "messages": [{"role": "assistant", "content": "Olá!"}]}
    response = client.post("/reply", json=body, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["handoff"] is True
