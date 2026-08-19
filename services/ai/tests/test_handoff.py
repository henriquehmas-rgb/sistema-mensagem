"""Heuristica de handoff pt-BR: positivos, negativos e motivos."""

from __future__ import annotations

import pytest

from src.handoff import detect_handoff

POSITIVE_CASES = [
    ("Quero falar com um atendente agora, por favor", "pedido_de_atendimento_humano"),
    ("Me transfere para uma pessoa de verdade", "pedido_de_atendimento_humano"),
    ("Não quero falar com robô, quero atendimento humano", "pedido_de_atendimento_humano"),
    ("Quero cancelar minha assinatura hoje", "cancelamento"),
    ("Isso é um absurdo, vou entrar no PROCON", "reclamacao_grave"),
    ("Que merda de serviço é esse?", "linguagem_ofensiva"),
    ("Meu cartão é 4111 1111 1111 1111, pode cobrar", "dados_sensiveis_pagamento"),
    ("O número do meu cartão não está passando, cvv 123", "dados_sensiveis_pagamento"),
    ("Meu CPF é 123.456.789-00, pode conferir meu cadastro?", "dados_sensiveis_documento"),
    ("meu cpf eh 12345678900 pode conferir", "dados_sensiveis_documento"),
    ("Preciso atualizar o número do meu RG no cadastro", "dados_sensiveis_documento"),
]

NEGATIVE_CASES = [
    "Qual o horário de funcionamento da loja?",
    "Vocês entregam no bairro Centro?",
    "Quanto custa o plano premium por mês?",
    "Como acompanho o status do meu pedido?",
    "O atendimento de vocês funciona aos sábados?",
    # Bare "documento" sem cpf/rg/identidade não deve disparar handoff — a
    # palavra sozinha é comum demais em pt-BR para justificar o falso positivo.
    "Posso te enviar um documento assinado por aqui?",
    "Vou precisar de mais um dia útil para separar o pedido, urgente pra mim.",
]


@pytest.mark.parametrize(("text", "expected_reason"), POSITIVE_CASES)
def test_handoff_positive_cases(text: str, expected_reason: str) -> None:
    assert detect_handoff(text) == expected_reason


@pytest.mark.parametrize("text", NEGATIVE_CASES)
def test_handoff_negative_cases(text: str) -> None:
    assert detect_handoff(text) is None


def test_detection_ignores_accents_and_case() -> None:
    assert detect_handoff("QUERO FALAR COM UM ATENDENTE") == "pedido_de_atendimento_humano"
    assert detect_handoff("isso e inaceitavel!") == "reclamacao_grave"
