"""Multi-turn shadow regressions for Financeiro and Vendas.

No test opens a real sector pilot, accesses IXC, or enables writes.
"""

from __future__ import annotations

from src import retrieval
from src.config import get_settings
from src.retrieval import RetrievedChunk
from src.routes import reply as reply_route


class _NaturalProvider:
    def generate(self, _messages, _system):  # noqa: ANN001 - provider contract
        return "Certo. Vou seguir somente com as informações confirmadas para este atendimento."


def _shadow(monkeypatch, route_key: str) -> None:
    monkeypatch.setenv("PILOT_ROUTE_KEY", route_key)
    monkeypatch.setenv("PILOT_ROUTE_KEYS", route_key)
    get_settings.cache_clear()
    monkeypatch.setattr(
        retrieval,
        "search",
        lambda *_args, **_kwargs: [
            RetrievedChunk(
                content="Orientação aprovada e limitada ao fluxo consultado.",
                score=0.95,
                source_id=f"{route_key}-approved",
                source_meta={"governance": "APPROVED", "department": route_key},
            ),
        ],
    )
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda *args, **kwargs: _NaturalProvider())


def test_billing_keeps_context_after_identity_without_repeating_the_challenge(client, auth_headers, monkeypatch) -> None:
    _shadow(monkeypatch, "billing")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-multi-turn",
            "contact": {"name": "Homologação"}, "identity_verified": True,
            "operational_skills": [{
                "key": "billing-invoice-copy", "name": "Segunda via", "version": 1,
                "route_key": "billing", "trigger_conditions": ["fatura"],
                "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Consultar título atual"],
                "allowed_actions": ["read_invoice"], "forbidden_actions": ["change_invoice"],
            }],
            "operational_context": {
                "identity_verified": True, "identity_required_now": True,
                "planned_actions": ["invoices", "contracts"],
                "previous_intent": "billing",
                "evidence": {"source": "IXC", "status": "success", "observedAt": "2026-09-10T12:00:00Z", "facts": []},
            },
            "messages": [
                {"role": "user", "content": "Preciso da segunda via da minha fatura."},
                {"role": "assistant", "content": "Vou confirmar seu cadastro antes da consulta."},
                {"role": "user", "content": "A validação já foi concluída."},
                {"role": "assistant", "content": "Pronto, cadastro confirmado."},
                {"role": "user", "content": "Pode seguir com a fatura atual?"},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "billing"
    assert result["selected_skill_key"] == "billing-invoice-copy"
    assert "CPF" not in result["reply"]


def test_billing_invoice_uses_current_ixc_evidence_when_rag_is_below_skill_floor(client, auth_headers, monkeypatch) -> None:
    """Uma fatura atual do IXC não pode perder para similaridade semântica menor."""
    _shadow(monkeypatch, "billing")
    monkeypatch.setattr(
        retrieval,
        "search",
        lambda *_args, **_kwargs: [
            RetrievedChunk(
                content="Segunda via deve ser entregue somente após confirmação e consulta atual.",
                score=0.50,
                source_id="billing-invoice-copy-approved",
                source_meta={"governance": "APPROVED", "department": "billing"},
            ),
        ],
    )
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-invoice-current-ixc",
            "contact": {"name": "Homologação"}, "identity_verified": True,
            "operational_skills": [{
                "key": "billing-invoice-copy", "name": "Segunda via", "version": 1,
                "route_key": "billing", "trigger_conditions": ["fatura"],
                "allowed_sources": ["RAG_APPROVED", "IXC_READ"],
                "protocol_steps": ["Consultar título atual"],
                "allowed_actions": ["read_invoice", "deliver_official_invoice_copy"],
                "forbidden_actions": ["change_invoice", "execute_external_write"],
                "minimum_confidence": 0.92,
            }],
            "operational_context": {
                "identity_verified": True, "identity_required_now": True,
                "planned_actions": ["invoices", "contracts"], "previous_intent": "billing",
                "evidence": {
                    "source": "IXC", "status": "success", "observedAt": "2026-09-16T12:00:00Z",
                    "facts": [{"resource": "invoices", "entityRef": "invoice_shadow", "fields": {"status": "OPEN"}}],
                },
            },
            "messages": [{"role": "user", "content": "Preciso da segunda via da minha fatura."}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["selected_skill_key"] == "billing-invoice-copy"
    assert result["confidence"] == 0.92
    assert "CPF" not in result["reply"]


def test_sales_proposal_keeps_public_context_without_requesting_identity(client, auth_headers, monkeypatch) -> None:
    _shadow(monkeypatch, "sales")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "sales-multi-turn",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "sales-standard-proposal", "name": "Proposta padrão", "version": 1,
                "route_key": "sales", "trigger_conditions": ["proposta"],
                "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Usar modelo homologado"],
                "allowed_actions": ["prepare_standard_proposal"], "forbidden_actions": ["grant_discount"],
            }],
            "messages": [
                {"role": "user", "content": "Quero conhecer os planos."},
                {"role": "assistant", "content": "Posso entender o que você procura."},
                {"role": "user", "content": "É para casa e quero uma proposta padrão."},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "sales"
    assert result["selected_skill_key"] == "sales-standard-proposal"
    assert "CPF" not in result["reply"]


def test_sales_first_turn_asks_usage_before_location(client, auth_headers, monkeypatch) -> None:
    """Uma pergunta de descoberta antecede a consulta factual de disponibilidade."""
    _shadow(monkeypatch, "sales")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "sales-first-turn-residential",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "sales-plan-qualification", "name": "Qualificação", "version": 2,
                "route_key": "sales", "trigger_conditions": ["proposta residencial"],
                "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Uma pergunta proporcional por vez"],
                "allowed_actions": ["prepare_lead_intake", "read_published_plan"],
                "forbidden_actions": ["guarantee_coverage", "quote_unapproved_price", "execute_external_write"],
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "case_state": {
                    "schemaVersion": 1, "route": "sales", "customerProfile": "RESIDENTIAL",
                    "primaryUsage": "UNKNOWN", "cityNeighborhoodProvided": False,
                    "addressProvided": False, "nextStep": "ASK_PRIMARY_USAGE",
                },
            },
            "messages": [{"role": "user", "content": "Quero uma proposta de internet para casa."}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "sales"
    assert result["reply"].startswith(("Bom dia!", "Boa tarde!", "Boa noite!"))
    assert "o que você mais usa" in result["reply"].lower()
    assert "localização" not in result["reply"].lower()
    assert "casa ou para empresa" not in result["reply"].lower()
    assert "CPF" not in result["reply"]


def test_sales_address_waits_for_official_coverage_evidence_without_promising_it(client, auth_headers, monkeypatch) -> None:
    """Após a qualificação, não inventamos cobertura nem plano compatível."""
    _shadow(monkeypatch, "sales")
    # O fallback continua disponível quando a organização ainda não homologou
    # o formulário oficial. A limpeza evita herdar uma configuração externa.
    monkeypatch.delenv("IXC_INMAP_AUTO_VIABILITY_PUBLIC_URL", raising=False)
    get_settings.cache_clear()
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "sales-coverage-evidence-boundary",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "sales-plan-qualification", "name": "Qualificação", "version": 2,
                "route_key": "sales", "trigger_conditions": ["proposta residencial"],
                "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Uma pergunta proporcional por vez"],
                "allowed_actions": ["prepare_lead_intake", "read_published_plan"],
                "forbidden_actions": ["guarantee_coverage", "quote_unapproved_price", "execute_external_write"],
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "sales", "triage_confidence": 0.9,
                "case_state": {
                    "schemaVersion": 1, "route": "sales", "customerProfile": "RESIDENTIAL",
                    "primaryUsage": "STREAMING", "cityNeighborhoodProvided": True,
                    "addressProvided": True, "coverageEvidenceRequested": False,
                    "nextStep": "REQUEST_COVERAGE_EVIDENCE",
                },
            },
            "messages": [
                {"role": "assistant", "content": "Para confirmar a disponibilidade, me informe a rua e o número do endereço."},
                {"role": "user", "content": "Rua das Flores, 120."},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "sales"
    assert result["reply"] == (
        "Obrigado. Com o endereço informado, a disponibilidade ainda precisa ser confirmada na base oficial "
        "antes de eu indicar os planos compatíveis. Não quero te prometer cobertura sem essa verificação."
    )
    assert "CPF" not in result["reply"]
    assert "cobertura confirmada" not in result["reply"].lower()


def test_sales_address_never_points_to_a_form(client, auth_headers, monkeypatch) -> None:
    """A confirmação permanece no WhatsApp, mesmo se sobrar uma URL legada."""
    _shadow(monkeypatch, "sales")
    official_url = "https://ixc.example.test/app/inmap-auto-viability?campaignId=11&channelId=15"
    monkeypatch.setenv("IXC_INMAP_AUTO_VIABILITY_PUBLIC_URL", official_url)
    get_settings.cache_clear()
    try:
        result = client.post(
            "/reply",
            json={
                "org_id": "org_shadow", "conversation_id": "sales-coverage-official-form",
                "contact": {"name": "Homologação"}, "identity_verified": False,
                "operational_skills": [{
                    "key": "sales-coverage-intake", "name": "Cobertura", "version": 2,
                    "route_key": "sales", "trigger_conditions": ["proposta residencial"],
                    "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Uma pergunta por vez"],
                    "allowed_actions": ["prepare_lead_intake"],
                    "forbidden_actions": ["guarantee_coverage", "execute_external_write"],
                }],
                "operational_context": {
                    "identity_verified": False, "identity_required_now": False,
                    "previous_intent": "sales", "triage_confidence": 0.9,
                    "case_state": {
                        "schemaVersion": 1, "route": "sales", "customerProfile": "RESIDENTIAL",
                        "primaryUsage": "STREAMING", "cityNeighborhoodProvided": True,
                        "addressProvided": True, "coverageEvidenceRequested": False,
                        "nextStep": "REQUEST_COVERAGE_EVIDENCE",
                    },
                },
                "messages": [
                    {"role": "assistant", "content": "Informe a rua e o número."},
                    {"role": "user", "content": "Rua das Flores, 120."},
                ],
            }, headers=auth_headers,
        ).json()
    finally:
        monkeypatch.delenv("IXC_INMAP_AUTO_VIABILITY_PUBLIC_URL")
        get_settings.cache_clear()

    assert result["reply"] == (
        "Obrigado. Com o endereço informado, a disponibilidade ainda precisa ser confirmada na base oficial "
        "antes de eu indicar os planos compatíveis. Não quero te prometer cobertura sem essa verificação."
    )
    assert official_url not in result["reply"]
    assert "Rua das Flores" not in result["reply"]
    assert "cobertura confirmada" not in result["reply"].lower()


def test_sales_coverage_consent_never_uses_an_official_form(client, auth_headers, monkeypatch) -> None:
    """O fallback mantém o atendimento, sem empurrar o cliente para fora do WhatsApp."""
    _shadow(monkeypatch, "sales")
    official_url = "https://ixc.example.test/app/inmap-auto-viability?campaignId=11&channelId=15"
    monkeypatch.setenv("IXC_INMAP_AUTO_VIABILITY_PUBLIC_URL", official_url)
    get_settings.cache_clear()
    try:
        result = client.post(
            "/reply",
            json={
                "org_id": "org_shadow", "conversation_id": "sales-coverage-consent",
                "contact": {"name": "Homologação"}, "identity_verified": False,
                "operational_skills": [{
                    "key": "sales-plan-qualification", "name": "Qualificação", "version": 2,
                    "route_key": "sales", "trigger_conditions": ["proposta residencial"],
                    "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Uma pergunta por vez"],
                    "allowed_actions": ["prepare_lead_intake"],
                    "forbidden_actions": ["guarantee_coverage", "execute_external_write"],
                }],
                "operational_context": {
                    "identity_verified": False, "identity_required_now": False,
                    "previous_intent": "sales", "triage_confidence": 0.9,
                    "case_state": {
                        "schemaVersion": 1, "route": "sales", "customerProfile": "RESIDENTIAL",
                        "primaryUsage": "REMOTE_WORK", "cityNeighborhoodProvided": True,
                        "addressProvided": True, "coverageEvidenceRequested": True,
                        "coverageCheckStatus": "NOT_CHECKED", "nextStep": "CONTINUE_SAFE_QUALIFICATION",
                    },
                },
                "messages": [
                    {"role": "assistant", "content": "Esse detalhe precisa de revisão antes de eu te dar uma resposta."},
                    {"role": "user", "content": "Pode sim"},
                ],
            }, headers=auth_headers,
        ).json()
    finally:
        monkeypatch.delenv("IXC_INMAP_AUTO_VIABILITY_PUBLIC_URL")
        get_settings.cache_clear()

    assert result["handoff"] is False, result
    assert result["reply"] == (
        "A consulta oficial deveria acontecer por aqui. Ela não foi iniciada agora, "
        "então vou manter seu atendimento para revisão comercial sem te encaminhar a um formulário."
    )
    assert official_url not in result["reply"]
    assert "cobertura confirmada" not in result["reply"].lower()


def test_sales_discount_request_stays_in_review_after_a_longer_context(client, auth_headers, monkeypatch) -> None:
    _shadow(monkeypatch, "sales")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "sales-discount-multi-turn",
            "contact": {"name": "Homologação"},
            "operational_skills": [{
                "key": "sales-standard-proposal", "name": "Proposta padrão", "version": 1,
                "route_key": "sales", "trigger_conditions": ["proposta"],
                "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Usar modelo homologado"],
                "allowed_actions": ["prepare_standard_proposal"], "forbidden_actions": ["grant_discount"],
            }],
            "messages": [
                {"role": "user", "content": "Quero uma proposta padrão."},
                {"role": "assistant", "content": "Posso mostrar as condições oficiais."},
                {"role": "user", "content": "Gostei, mas consegue um desconto para fechar hoje?"},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is True
    assert result["handoff_reason"] == "commercial_approval_required"


def test_billing_general_policy_does_not_request_identity_or_invent_terms(client, auth_headers, monkeypatch) -> None:
    _shadow(monkeypatch, "billing")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-policy-general",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "billing-policy-boundary", "name": "Política financeira", "version": 1,
                "route_key": "billing", "trigger_conditions": ["parcelamento e juros"],
                "allowed_sources": ["RAG_APPROVED"],
                "protocol_steps": ["Distinguir regra geral de condição individual"],
                "allowed_actions": ["explain_approved_financial_policy"],
                "forbidden_actions": ["grant_discount", "negotiate_terms", "execute_external_write"],
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "billing", "triage_confidence": 0.9,
            },
            "messages": [{"role": "user", "content": "Quais são as regras gerais de juros e parcelamento?"}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "billing"
    assert result["selected_skill_key"] == "billing-policy-boundary"
    assert "CPF" not in result["reply"]
    assert "desconto" not in result["reply"].lower()


def test_billing_general_policy_accepts_relevant_approved_rag_below_i2_threshold(client, auth_headers, monkeypatch) -> None:
    """Uma política geral não deve exigir a confiança de uma consulta individual."""
    _shadow(monkeypatch, "billing")
    monkeypatch.setattr(
        retrieval,
        "search",
        lambda *_args, **_kwargs: [
            RetrievedChunk(
                content="Política aprovada: condições individuais não são prometidas no atendimento.",
                score=0.75,
                source_id="billing-approved-policy",
                source_meta={"governance": "APPROVED", "department": "billing"},
            ),
        ],
    )
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-policy-relevant-rag",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "billing-policy-boundary", "name": "Política financeira", "version": 1,
                "route_key": "billing", "trigger_conditions": ["parcelamento e juros"],
                "allowed_sources": ["RAG_APPROVED"],
                "protocol_steps": ["Distinguir regra geral de condição individual"],
                "allowed_actions": ["explain_approved_financial_policy"],
                "forbidden_actions": ["grant_discount", "negotiate_terms", "execute_external_write"],
                "minimum_confidence": 0.92,
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "billing", "triage_confidence": 0.9,
            },
            "messages": [{"role": "user", "content": "Quais são as regras gerais de juros e parcelamento?"}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["selected_skill_key"] == "billing-policy-boundary"


def test_public_billing_policy_accepts_a_short_but_approved_match(client, auth_headers, monkeypatch) -> None:
    """Formulações curtas seguem autônomas somente dentro da política aprovada."""
    _shadow(monkeypatch, "billing")
    monkeypatch.setattr(
        retrieval,
        "search",
        lambda *_args, **_kwargs: [
            RetrievedChunk(
                content="Política aprovada de parcelamento sem negociação individual.",
                score=0.60,
                source_id="billing-approved-policy-short-match",
                source_meta={"governance": "APPROVED", "department": "billing"},
            ),
        ],
    )
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-policy-short-match",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "billing-policy-boundary", "name": "Política financeira", "version": 1,
                "route_key": "billing", "trigger_conditions": ["parcelamento"],
                "allowed_sources": ["RAG_APPROVED"],
                "protocol_steps": ["Distinguir regra geral de condição individual"],
                "allowed_actions": ["explain_approved_financial_policy"],
                "forbidden_actions": ["grant_discount", "negotiate_terms", "execute_external_write"],
                "minimum_confidence": 0.92,
            }],
            "operational_context": {"identity_verified": False, "identity_required_now": False},
            "messages": [{"role": "user", "content": "Como funciona o parcelamento da fatura?"}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["selected_skill_key"] == "billing-policy-boundary"


def test_public_billing_policy_retries_a_spurious_llm_handoff_once(client, auth_headers, monkeypatch) -> None:
    """O modelo não pode delegar uma regra pública já coberta por fonte aprovada."""
    _shadow(monkeypatch, "billing")
    monkeypatch.setattr(
        retrieval,
        "search",
        lambda *_args, **_kwargs: [
            RetrievedChunk(
                content="Política aprovada de parcelamento sem negociação individual.",
                score=0.66,
                source_id="billing-approved-policy-retry",
                source_meta={"governance": "APPROVED", "department": "billing"},
            ),
        ],
    )

    class _HandoffThenPublicReply:
        calls = 0

        def generate(self, _messages, _system):  # noqa: ANN001 - provider contract
            self.calls += 1
            return "[HANDOFF] baixa confiança"

    provider = _HandoffThenPublicReply()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda *args, **kwargs: provider)
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-policy-retry",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "billing-policy-boundary", "name": "Política financeira", "version": 1,
                "route_key": "billing", "trigger_conditions": ["parcelamento"],
                "allowed_sources": ["RAG_APPROVED"],
                "protocol_steps": ["Distinguir regra geral de condição individual"],
                "allowed_actions": ["explain_approved_financial_policy"],
                "forbidden_actions": ["grant_discount", "negotiate_terms", "execute_external_write"],
                "minimum_confidence": 0.92,
            }],
            "operational_context": {"identity_verified": False, "identity_required_now": False},
            "messages": [{"role": "user", "content": "Como funciona o parcelamento da fatura?"}],
        }, headers=auth_headers,
    ).json()

    assert provider.calls == 2
    assert result["handoff"] is False, result
    assert result["selected_skill_key"] == "billing-policy-boundary"
    assert "regra geral do parcelamento" in result["reply"]
    assert "CPF" not in result["reply"]


def test_public_sales_catalog_accepts_a_short_approved_match(client, auth_headers, monkeypatch) -> None:
    """Catálogo público pode responder com match curto de conhecimento aprovado."""
    _shadow(monkeypatch, "sales")
    monkeypatch.setattr(
        retrieval,
        "search",
        lambda *_args, **_kwargs: [
            RetrievedChunk(
                content="Catálogo IXC aprovado; cobertura e condições dependem de confirmação posterior.",
                score=0.60,
                source_id="sales-approved-ixc-catalog-short-match",
                source_meta={"governance": "APPROVED", "department": "sales"},
            ),
        ],
    )
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "sales-catalog-short-match",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "sales-plan-qualification", "name": "Planos", "version": 1,
                "route_key": "sales", "trigger_conditions": ["planos"],
                "allowed_sources": ["RAG_APPROVED", "IXC_READ"],
                "protocol_steps": ["Apresentar somente catálogo publicado"],
                "allowed_actions": ["read_published_plan"],
                "forbidden_actions": ["quote_unapproved_price", "guarantee_coverage", "execute_external_write"],
                "minimum_confidence": 0.90,
            }],
            "operational_context": {"identity_verified": False, "identity_required_now": False},
            "messages": [{"role": "user", "content": "Quais planos de internet estão disponíveis?"}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["selected_skill_key"] == "sales-plan-qualification"


def test_explicit_sales_question_overrides_continued_billing_context(client, auth_headers, monkeypatch) -> None:
    """Continuidade nunca deve prender a conversa no setor anterior."""
    _shadow(monkeypatch, "sales")
    search_queries: list[str] = []

    def search(_org_id, query, **_kwargs):  # noqa: ANN001 - retrieval contract
        search_queries.append(query)
        return [
            RetrievedChunk(
                content="Catálogo IXC aprovado; cobertura depende de confirmação posterior.",
                score=0.60,
                source_id="sales-approved-ixc-catalog-cross-sector",
                source_meta={"governance": "APPROVED", "department": "sales", "factualSource": "IXC"},
            ),
        ]

    monkeypatch.setattr(
        retrieval,
        "search",
        search,
    )
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-to-sales-explicit",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [
                {
                    "key": "billing-policy-boundary", "name": "Política financeira", "version": 1,
                    "route_key": "billing", "allowed_actions": ["explain_approved_financial_policy"],
                    "forbidden_actions": ["negotiate_terms", "execute_external_write"],
                },
                {
                    "key": "sales-plan-qualification", "name": "Planos", "version": 1,
                    "route_key": "sales", "trigger_conditions": ["planos"],
                    "allowed_sources": ["RAG_APPROVED", "IXC_READ"],
                    "protocol_steps": ["Apresentar somente catálogo publicado"],
                    "allowed_actions": ["read_published_plan"],
                    "forbidden_actions": ["quote_unapproved_price", "guarantee_coverage", "execute_external_write"],
                    "minimum_confidence": 0.90,
                },
            ],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "billing", "continued_from_previous": True,
                "triage_confidence": 0.9,
            },
            "messages": [
                {"role": "user", "content": "Como funciona o parcelamento da fatura?"},
                {"role": "assistant", "content": "Vou explicar a política geral aprovada."},
                {"role": "user", "content": "Também quero conhecer os planos de internet disponíveis."},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "sales"
    assert result["selected_skill_key"] == "sales-plan-qualification"
    assert search_queries == ["quero conhecer os planos de internet disponíveis."]


def test_public_billing_question_overrides_previous_support_context(client, auth_headers, monkeypatch) -> None:
    """Uma dúvida pública financeira não pode herdar diagnóstico técnico."""
    _shadow(monkeypatch, "billing")
    search_queries: list[str] = []

    def search(_org_id, query, **_kwargs):  # noqa: ANN001 - retrieval contract
        search_queries.append(query)
        return [
            RetrievedChunk(
                content="Política financeira aprovada, sem negociação individual.",
                score=0.60,
                source_id="billing-approved-policy-after-support",
                source_meta={"governance": "APPROVED", "department": "billing"},
            ),
        ]

    monkeypatch.setattr(retrieval, "search", search)
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "support-to-billing-public",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "billing-policy-boundary", "name": "Política financeira", "version": 1,
                "route_key": "billing", "trigger_conditions": ["parcelamento"],
                "allowed_sources": ["RAG_APPROVED"],
                "protocol_steps": ["Distinguir política geral de condição individual"],
                "allowed_actions": ["explain_approved_financial_policy"],
                "forbidden_actions": ["negotiate_terms", "execute_external_write"],
                "minimum_confidence": 0.90,
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "technical_support", "continued_from_previous": True,
                "triage_confidence": 0.9,
            },
            "messages": [
                {"role": "user", "content": "Minha internet caiu e a luz LOS está vermelha."},
                {"role": "assistant", "content": "Vamos verificar a conexão por etapas."},
                {"role": "user", "content": "Como funciona o parcelamento da fatura?"},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "billing"
    assert result["selected_skill_key"] == "billing-policy-boundary"
    assert "CPF" not in result["reply"]
    assert search_queries == ["Como funciona o parcelamento da fatura?"]


def test_public_sales_question_overrides_previous_support_context(client, auth_headers, monkeypatch) -> None:
    """Uma consulta pública de planos não consulta a conexão anterior."""
    _shadow(monkeypatch, "sales")
    search_queries: list[str] = []

    def search(_org_id, query, **_kwargs):  # noqa: ANN001 - retrieval contract
        search_queries.append(query)
        return [
            RetrievedChunk(
                content="Catálogo IXC aprovado; cobertura depende de confirmação posterior.",
                score=0.60,
                source_id="sales-approved-ixc-catalog-after-support",
                source_meta={"governance": "APPROVED", "department": "sales", "factualSource": "IXC"},
            ),
        ]

    monkeypatch.setattr(retrieval, "search", search)
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "support-to-sales-public",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "sales-plan-qualification", "name": "Planos", "version": 1,
                "route_key": "sales", "trigger_conditions": ["planos"],
                "allowed_sources": ["RAG_APPROVED", "IXC_READ"],
                "protocol_steps": ["Apresentar somente catálogo publicado"],
                "allowed_actions": ["read_published_plan"],
                "forbidden_actions": ["guarantee_coverage", "quote_unapproved_price", "execute_external_write"],
                "minimum_confidence": 0.90,
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "technical_support", "continued_from_previous": True,
                "triage_confidence": 0.9,
            },
            "messages": [
                {"role": "user", "content": "Minha internet caiu e a luz LOS está vermelha."},
                {"role": "assistant", "content": "Vamos verificar a conexão por etapas."},
                {"role": "user", "content": "Quais planos de internet estão disponíveis?"},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "sales"
    assert result["selected_skill_key"] == "sales-plan-qualification"
    assert "CPF" not in result["reply"]
    assert search_queries == ["Quais planos de internet estão disponíveis?"]


def test_billing_payment_wins_over_an_earlier_invoice_context(client, auth_headers, monkeypatch) -> None:
    _shadow(monkeypatch, "billing")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-payment-after-invoice",
            "contact": {"name": "Homologação"}, "identity_verified": True,
            "operational_skills": [
                {
                    "key": "billing-invoice-copy", "name": "Segunda via", "version": 1,
                    "route_key": "billing", "trigger_conditions": ["fatura"],
                    "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Consultar título"],
                    "allowed_actions": ["read_invoice"], "forbidden_actions": ["execute_external_write"],
                },
                {
                    "key": "billing-unrecognized-payment", "name": "Pagamento", "version": 1,
                    "route_key": "billing", "trigger_conditions": ["pagamento"],
                    "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Consultar compensação"],
                    "allowed_actions": ["read_payment"], "forbidden_actions": ["execute_external_write"],
                },
            ],
            "operational_context": {
                "identity_verified": True, "identity_required_now": False,
                "previous_intent": "billing", "triage_confidence": 0.9,
            },
            "messages": [
                {"role": "user", "content": "Eu precisava da segunda via da fatura."},
                {"role": "assistant", "content": "Entendi, vou considerar a fatura atual."},
                {"role": "user", "content": "Paguei agora, mas o pagamento ainda não compensou."},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["selected_skill_key"] == "billing-unrecognized-payment"
    assert "CPF" not in result["reply"]


def test_sales_coverage_has_priority_and_stays_without_identity_or_promise(client, auth_headers, monkeypatch) -> None:
    _shadow(monkeypatch, "sales")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "sales-coverage-consent",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [
                {
                    "key": "sales-coverage-intake", "name": "Cobertura", "version": 1,
                    "route_key": "sales", "trigger_conditions": ["cobertura e viabilidade"],
                    "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Não prometer cobertura"],
                    "allowed_actions": ["collect_minimum_coverage_context"],
                    "forbidden_actions": ["guarantee_coverage", "register_lead", "execute_external_write"],
                },
                {
                    "key": "sales-follow-up-consent", "name": "Retorno", "version": 1,
                    "route_key": "sales", "trigger_conditions": ["me ligar"],
                    "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Confirmar consentimento"],
                    "allowed_actions": ["prepare_follow_up_consent"],
                    "forbidden_actions": ["send_message", "place_call", "execute_external_write"],
                },
            ],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "sales", "triage_confidence": 0.9,
            },
            "messages": [{"role": "user", "content": "Tem cobertura no meu endereço? Se der, pode me ligar amanhã."}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "sales"
    assert result["selected_skill_key"] == "sales-coverage-intake"
    assert "CPF" not in result["reply"]
    assert "cobertura confirmada" not in result["reply"].lower()


def test_sales_accepts_free_text_commercial_interest_without_a_menu_or_identity(client, auth_headers, monkeypatch) -> None:
    _shadow(monkeypatch, "sales")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "sales-commercial-free-text",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "sales-plan-qualification", "name": "Qualificação", "version": 1,
                "route_key": "sales", "trigger_conditions": ["interesse em contratação comercial"],
                "allowed_sources": ["RAG_APPROVED"],
                "protocol_steps": ["Entender necessidade antes de recomendar"],
                "allowed_actions": ["prepare_lead_intake"],
                "forbidden_actions": ["register_lead", "execute_external_write"],
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "sales", "triage_confidence": 0.9,
            },
            "messages": [{"role": "user", "content": "Vocês têm internet comercial para minha empresa?"}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "sales"
    assert result["selected_skill_key"] == "sales-plan-qualification"
    assert "CPF" not in result["reply"]
    assert "opção inválida" not in result["reply"].lower()


def test_billing_contract_summary_requires_identity_before_individual_lookup(client, auth_headers, monkeypatch) -> None:
    _shadow(monkeypatch, "billing")
    searched = False

    def search(*_args, **_kwargs):
        nonlocal searched
        searched = True
        return []

    monkeypatch.setattr(retrieval, "search", search)
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-contract-summary-identity",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "billing-contract-summary", "name": "Contratos", "version": 1,
                "route_key": "billing", "trigger_conditions": ["contratos ativos"],
                "allowed_sources": ["IXC_READ", "RAG_APPROVED"],
                "protocol_steps": ["Confirmar identidade antes de consultar"],
                "allowed_actions": ["read_contract"],
                "forbidden_actions": ["renew_contract", "execute_external_write"],
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": True,
                "planned_actions": ["contracts"], "previous_intent": "billing",
                "triage_confidence": 0.9,
            },
            "messages": [{"role": "user", "content": "Quais contratos ativos tenho?"}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "billing"
    assert "CPF completo" in result["reply"]
    assert searched is False


def test_billing_customer_not_found_in_ixc_stays_a_technical_incident(client, auth_headers, monkeypatch) -> None:
    """Ausência de cadastro IXC não autoriza inventar fatura nem abrir um GAP."""
    _shadow(monkeypatch, "billing")
    searched = False

    def search(*_args, **_kwargs):
        nonlocal searched
        searched = True
        return []

    monkeypatch.setattr(retrieval, "search", search)
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-customer-not-found",
            "contact": {"name": "Homologação"}, "identity_verified": True,
            "operational_skills": [{
                "key": "billing-invoice-copy", "name": "Segunda via", "version": 1,
                "route_key": "billing", "allowed_sources": ["IXC_READ", "RAG_APPROVED"],
                "protocol_steps": ["Consultar somente após confirmação"],
                "allowed_actions": ["read_invoice"], "forbidden_actions": ["execute_external_write"],
            }],
            "operational_context": {
                "identity_verified": True, "identity_required_now": True,
                "planned_actions": ["invoices", "contracts"], "previous_intent": "billing",
                "evidence": {"source": "IXC", "status": "customer_not_found", "facts": []},
            },
            "messages": [{"role": "user", "content": "Preciso da segunda via da minha fatura."}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is True
    assert result["handoff_reason"] == "cliente_nao_localizado_no_ixc"
    assert result["reply"] is None
    assert searched is False


def test_billing_identity_prompt_uses_financial_scope_not_connection(client, auth_headers, monkeypatch) -> None:
    """A proteção de identidade mantém a linguagem do setor solicitado."""
    _shadow(monkeypatch, "billing")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-invoice-identity-language",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "billing-invoice-copy", "name": "Segunda via", "version": 1,
                "route_key": "billing", "trigger_conditions": ["fatura"],
                "allowed_sources": ["IXC_READ", "RAG_APPROVED"],
                "protocol_steps": ["Confirmar identidade antes de consultar"],
                "allowed_actions": ["read_invoice"],
                "forbidden_actions": ["execute_external_write"],
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": True,
                "planned_actions": ["invoices"], "previous_intent": "billing",
                "triage_confidence": 0.9,
            },
            "messages": [{"role": "user", "content": "Preciso da segunda via da minha fatura."}],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert "situação da sua fatura" in result["reply"]
    assert "sua conexão" not in result["reply"]


def test_billing_free_text_request_for_a_person_never_falls_back_to_a_menu(client, auth_headers, monkeypatch) -> None:
    """Um pedido humano livre é encaminhamento governado, não erro de opção."""
    _shadow(monkeypatch, "billing")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "billing-human-free-text",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "billing-invoice-copy", "name": "Segunda via", "version": 1,
                "route_key": "billing", "trigger_conditions": ["fatura"],
                "allowed_sources": ["RAG_APPROVED"], "protocol_steps": ["Consultar título"],
                "allowed_actions": ["read_invoice"], "forbidden_actions": ["execute_external_write"],
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "billing", "triage_confidence": 0.9,
            },
            "messages": [
                {"role": "user", "content": "Estou com dúvida sobre a fatura."},
                {"role": "assistant", "content": "Posso orientar por aqui."},
                {"role": "user", "content": "Quero falar com atendente."},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is True
    assert result["handoff_reason"] == "pedido_de_atendimento_humano"
    assert result["reply"] is None


def test_sales_business_qualification_keeps_context_without_promising_plan_or_coverage(client, auth_headers, monkeypatch) -> None:
    _shadow(monkeypatch, "sales")
    result = client.post(
        "/reply",
        json={
            "org_id": "org_shadow", "conversation_id": "sales-business-context",
            "contact": {"name": "Homologação"}, "identity_verified": False,
            "operational_skills": [{
                "key": "sales-business-qualification", "name": "Internet comercial", "version": 1,
                "route_key": "sales", "trigger_conditions": ["internet comercial"],
                "allowed_sources": ["RAG_APPROVED"],
                "protocol_steps": ["Uma pergunta proporcional por vez"],
                "allowed_actions": ["qualify_business_need"],
                "forbidden_actions": ["guarantee_coverage", "quote_unapproved_price", "execute_external_write"],
            }],
            "operational_context": {
                "identity_verified": False, "identity_required_now": False,
                "previous_intent": "sales", "triage_confidence": 0.9,
            },
            "messages": [
                {"role": "user", "content": "Preciso de internet comercial para minha empresa."},
                {"role": "assistant", "content": "Posso entender o uso para orientar o caminho certo."},
                {"role": "user", "content": "São cinco pessoas e usamos videoconferência."},
            ],
        }, headers=auth_headers,
    ).json()

    assert result["handoff"] is False, result
    assert result["route_key"] == "sales"
    assert result["selected_skill_key"] == "sales-business-qualification"
    assert "CPF" not in result["reply"]
    assert "cobertura confirmada" not in result["reply"].lower()
