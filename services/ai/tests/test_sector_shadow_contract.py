"""Contratos de homologação para ativar Financeiro e Vendas somente em sombra.

Estes testes não habilitam os setores em produção. Eles asseguram que, quando
o piloto for liberado explicitamente por ambiente, a conversa continue sujeita
às mesmas barreiras que foram validadas em Suporte.
"""

from __future__ import annotations

from src import retrieval
from src.config import get_settings
from src.retrieval import RetrievedChunk
from src.routes import reply as reply_route


AUTH_BODY_BASE = {
    "org_id": "org_shadow",
    "conversation_id": "sector-shadow-1",
    "contact": {"name": "Homologação"},
}


class _ApprovedReplyProvider:
    def generate(self, _messages, _system):  # noqa: ANN001 - contrato do provider
        return "Posso te orientar com as informações aprovadas, sem realizar nenhuma alteração."


def _enable_shadow_pilot(monkeypatch, route_key: str) -> None:
    monkeypatch.setenv("PILOT_ROUTE_KEY", route_key)
    monkeypatch.setenv("PILOT_ROUTE_KEYS", route_key)
    get_settings.cache_clear()


def test_billing_shadow_requires_identity_before_account_lookup(client, auth_headers, monkeypatch) -> None:
    _enable_shadow_pilot(monkeypatch, "billing")
    searched = False

    def search(*_args, **_kwargs):
        nonlocal searched
        searched = True
        return []

    monkeypatch.setattr(retrieval, "search", search)
    result = client.post(
        "/reply",
        json={
            **AUTH_BODY_BASE,
            "identity_verified": False,
            "operational_context": {
                "identity_verified": False,
                "identity_required_now": True,
                "planned_actions": ["invoices", "contracts"],
                "previous_intent": "billing",
                "triage_confidence": 0.9,
            },
            "messages": [{"role": "user", "content": "Quero consultar a minha fatura em atraso."}],
        },
        headers=auth_headers,
    ).json()

    assert result["handoff"] is False
    assert result["route_key"] == "billing"
    assert "CPF completo" in result["reply"]
    assert searched is False


def test_billing_shadow_accepts_only_approved_financial_context(client, auth_headers, monkeypatch) -> None:
    _enable_shadow_pilot(monkeypatch, "billing")
    monkeypatch.setattr(
        retrieval,
        "search",
        lambda *_args, **_kwargs: [
            RetrievedChunk(
                content="Para consultar a fatura, confirme a identidade antes de expor dados da conta.",
                score=0.95,
                source_id="financeiro-aprovado",
                source_meta={"governance": "APPROVED", "department": "billing"},
            ),
        ],
    )
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda *args, **kwargs: _ApprovedReplyProvider())
    result = client.post(
        "/reply",
        json={
            **AUTH_BODY_BASE,
            "identity_verified": True,
            "operational_skills": [{
                "key": "billing-read-only", "name": "Consulta financeira", "version": 1,
                "route_key": "billing", "allowed_actions": ["read_invoices"],
                "allowed_sources": ["RAG_APPROVED"], "minimum_confidence": 0.9,
            }],
            "operational_context": {
                "identity_verified": True,
                "planned_actions": ["invoices", "contracts"],
                "evidence": {"source": "IXC", "status": "success", "observedAt": "2026-09-09T12:00:00Z", "facts": []},
            },
            "messages": [{"role": "user", "content": "Quero conferir a minha fatura."}],
        },
        headers=auth_headers,
    ).json()

    assert result["handoff"] is False
    assert result["route_key"] == "billing"
    assert "financeiro-aprovado" in result["sources"]
    assert "read_invoices" not in result["reply"]


def test_sales_shadow_allows_catalog_guidance_but_blocks_special_terms(client, auth_headers, monkeypatch) -> None:
    _enable_shadow_pilot(monkeypatch, "sales")
    monkeypatch.setattr(
        retrieval,
        "search",
        lambda *_args, **_kwargs: [
            RetrievedChunk(
                content="Apresente somente opções e condições previamente aprovadas.",
                score=0.95,
                source_id="vendas-aprovado",
                source_meta={"governance": "APPROVED", "department": "sales"},
            ),
        ],
    )
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda *args, **kwargs: _ApprovedReplyProvider())
    common = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_skills": [{
            "key": "sales-catalog-read-only", "name": "Catálogo comercial", "version": 1,
            "route_key": "sales", "allowed_actions": ["guide_catalog"],
            "allowed_sources": ["RAG_APPROVED"], "minimum_confidence": 0.9,
        }],
    }
    catalog = client.post(
        "/reply",
        json={**common, "messages": [{"role": "user", "content": "Quero conhecer os planos disponíveis."}]},
        headers=auth_headers,
    ).json()
    special_terms = client.post(
        "/reply",
        json={**common, "messages": [{"role": "user", "content": "Consegue me dar um desconto especial?"}]},
        headers=auth_headers,
    ).json()

    assert catalog["handoff"] is False
    assert catalog["route_key"] == "sales"
    assert "vendas-aprovado" in catalog["sources"]
    assert special_terms["handoff"] is True
    assert special_terms["handoff_reason"] == "commercial_approval_required"
