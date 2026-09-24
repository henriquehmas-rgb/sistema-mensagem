"""Matrix for the twelve Financeiro/Vendas skills before a shadow pilot.

The tests exercise deterministic skill selection only. They do not query IXC,
do not call an LLM and do not enable either customer-facing sector.
"""

from __future__ import annotations

import pytest

from src.routes.reply import _approved_chunk_matches_route, _select_operational_skill
from src.schemas import OperationalSkillIn


SKILL_ROWS = (
    ("billing", "billing-invoice-copy", "Preciso da segunda via da fatura.", "Pedido de fatura ou boleto"),
    ("billing", "billing-unrecognized-payment", "Meu pagamento ainda não compensou.", "Cliente informa pagamento ainda não reconhecido"),
    ("billing", "billing-refund-preparation", "Quero solicitar um reembolso.", "Pedido de reembolso, estorno, chargeback, crédito ou compensação"),
    ("billing", "billing-cancellation-effects", "Quero cancelar meu contrato.", "Pedido de cancelamento durante atendimento financeiro"),
    ("billing", "billing-policy-boundary", "Posso parcelar a fatura?", "Dúvida sobre parcelamento, acordo, juros, multa ou condição de cobrança"),
    ("billing", "billing-contract-summary", "Quais contratos ativos tenho?", "Consulta de contratos ativos"),
    ("sales", "sales-plan-qualification", "Quero conhecer os planos disponíveis.", "Cliente quer conhecer planos"),
    ("sales", "sales-standard-proposal", "Preciso de uma proposta padrão.", "Cliente pede proposta padrão"),
    ("sales", "sales-retention-cancellation", "Quero cancelar meu contrato.", "Cliente pede cancelamento"),
    ("sales", "sales-coverage-intake", "Tem cobertura no meu endereço?", "Pergunta sobre cobertura, disponibilidade ou viabilidade de instalação"),
    ("sales", "sales-follow-up-consent", "Pode me chamar amanhã?", "Cliente pede retorno, ligação, mensagem ou acompanhamento"),
    ("sales", "sales-business-qualification", "Vocês têm internet comercial para a empresa?", "Interesse em internet comercial ou plano para empresa"),
)


def _skill(route_key: str, key: str, trigger: str) -> OperationalSkillIn:
    return OperationalSkillIn(
        key=key,
        name=key,
        version=1,
        route_key=route_key,
        trigger_conditions=[trigger],
        allowed_sources=["POLICY_APPROVED", "RAG_APPROVED", "IXC_READ", "CONVERSATION_CONTEXT"],
        protocol_steps=["Consultar somente fonte autorizada"],
        allowed_actions=["read_only_shadow_action"],
        forbidden_actions=["execute_external_write"],
    )


@pytest.mark.parametrize("route_key,key,question,trigger", SKILL_ROWS)
def test_sector_skill_matrix_selects_the_expected_skill(
    route_key: str, key: str, question: str, trigger: str
) -> None:
    skills = [_skill(row_route, row_key, row_trigger) for row_route, row_key, _, row_trigger in SKILL_ROWS]

    selected = _select_operational_skill(skills, route_key, question)

    assert selected is not None
    assert selected.key == key
    assert "RAG_APPROVED" in selected.allowed_sources
    assert "execute_external_write" in selected.forbidden_actions


@pytest.mark.parametrize("route_key", ("billing", "sales"))
def test_sector_rag_isolated_by_department(route_key: str) -> None:
    own = type("Chunk", (), {"source_meta": {"governance": "APPROVED", "department": route_key}})()
    other = type("Chunk", (), {"source_meta": {"governance": "APPROVED", "department": "sales" if route_key == "billing" else "billing"}})()

    assert _approved_chunk_matches_route(own, route_key) is True
    assert _approved_chunk_matches_route(other, route_key) is False
