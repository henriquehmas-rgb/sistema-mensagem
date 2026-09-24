from dataclasses import replace

from src.opa_history import (
    OpaConversation,
    OpaMessage,
    assess_humanization_auto_learning,
    classify_department,
    prepare_conversation,
    prepare_export,
    sanitize_text,
)


SALT = "seeg-homologacao-opa-2026"


def test_sanitize_text_removes_sensitive_identifiers_and_secrets() -> None:
    result = sanitize_text(
        "Meu CPF é 123.456.789-01, email ana@example.com, telefone 65999998888 "
        "e token: segredo-real https://example.com/cliente"
    )
    assert "123.456" not in result
    assert "ana@example" not in result
    assert "65999998888" not in result
    assert "segredo-real" not in result
    assert "example.com" not in result
    assert "[DOCUMENTO_REMOVIDO]" in result


def test_classification_uses_declared_department_or_unambiguous_content() -> None:
    assert classify_department("Quero a segunda via", "Vou consultar", None) == "financial"
    assert classify_department("Sem internet", "Reinicie o roteador", "Suporte") == "support"
    assert classify_department("Vocês têm internet comercial?", "Posso entender sua necessidade", None) == "sales"
    assert classify_department("Quero um plano e uma fatura", "", None) == "unknown"


def test_conversation_never_auto_publishes_and_separates_replay_deterministically() -> None:
    conversation = OpaConversation(
        source_id="opa-conversation-123",
        department="Suporte",
        messages=[
            OpaMessage(role="customer", content="Minha internet está sem conexão desde cedo"),
            OpaMessage(role="agent", content="Desligue o roteador por trinta segundos e ligue novamente para verificarmos."),
        ],
    )
    first = prepare_conversation(conversation, SALT)
    second = prepare_conversation(conversation, SALT)
    assert first == second
    assert len(first) == 1
    assert first[0].rag_publish_allowed is False
    assert first[0].disposition in {"REVIEW_PENDING", "REPLAY_ONLY"}
    assert first[0].source_ref.startswith("opa_")
    assert "opa-conversation-123" not in first[0].source_ref


def test_uncertain_or_commercial_answer_goes_to_quarantine() -> None:
    conversation = OpaConversation(
        source_id="opa-risk",
        department="Vendas",
        messages=[
            OpaMessage(role="customer", content="Consigo contratar um plano novo para minha casa?"),
            OpaMessage(role="agent", content="Acho que consigo liberar um desconto especial para você hoje."),
        ],
    )
    item = prepare_conversation(conversation, SALT)[0]
    assert item.disposition == "QUARANTINED"
    assert "commercial_commitment_requires_review" in item.rejection_reasons
    assert "uncertain_human_answer" in item.rejection_reasons


def test_prepare_export_accepts_neutral_shape_and_reports_governance() -> None:
    result = prepare_export({"conversations": [{
        "id": "conv-1",
        "department": "Financeiro",
        "messages": [
            {"direction": "inbound", "text": "Preciso consultar a segunda via da minha fatura"},
            {"direction": "outbound", "text": "Aguarde enquanto consulto o título correto antes de enviar."},
        ],
    }]}, SALT)
    assert result["source"] == "OPA_OFFLINE_EXPORT"
    assert result["runtime_dependency"] is False
    assert result["automatic_rag_publication"] is False
    assert sum(result["counts"].values()) == 1
    assert len(result["items"]) == 1


def test_short_or_low_value_exchange_is_quarantined() -> None:
    result = prepare_export([{
        "id": "conv-short",
        "messages": [
            {"role": "customer", "content": "Oi"},
            {"role": "agent", "content": "Certo"},
        ],
    }], SALT)
    assert result["items"][0]["disposition"] == "QUARANTINED"
    assert result["items"][0]["rag_publish_allowed"] is False


def test_robotic_menu_loop_from_historical_financial_flow_is_quarantined() -> None:
    item = prepare_conversation(OpaConversation(
        source_id="opa-financial-menu-loop",
        department="Financeiro",
        messages=[
            OpaMessage(role="customer", content="Quero falar com um atendente."),
            OpaMessage(role="agent", content="Opção inválida! Selecione ou digite uma das opções disponíveis."),
        ],
    ), SALT)[0]
    assert item.disposition == "QUARANTINED"
    assert "robotic_menu_loop" in item.rejection_reasons
    assert "human_request_ignored_by_menu" in item.rejection_reasons


def test_historical_operational_commitment_is_quarantined_not_learned() -> None:
    item = prepare_conversation(OpaConversation(
        source_id="opa-unsupported-operational-commitment",
        department="Financeiro",
        messages=[
            OpaMessage(role="customer", content="Minha conexão foi bloqueada por uma cobrança?"),
            OpaMessage(role="agent", content="Vou realizar um desbloqueio por confiança e encaminhar o boleto."),
        ],
    ), SALT)[0]
    assert item.disposition == "QUARANTINED"
    assert "unsupported_operational_commitment" in item.rejection_reasons


def test_humanization_can_be_auto_eligible_only_when_every_safe_gate_passes() -> None:
    item = prepare_conversation(OpaConversation(
        source_id="opa-natural",
        department="Suporte",
        messages=[
            OpaMessage(role="customer", content="Oi, minha internet caiu"),
            OpaMessage(role="agent", content="Oi! Vou olhar isso com você. A luz vermelha apareceu no aparelho?"),
        ],
    ), SALT)[0]
    assessment = assess_humanization_auto_learning(
        replace(item, disposition="REVIEW_PENDING"),
        semantic_compatibility=0.93,
        source_compatibility=0.91,
        replay_passed=True,
        conflict_free=True,
    )
    assert assessment.eligible is True


def test_humanization_auto_learning_never_uses_average_to_hide_a_weak_source() -> None:
    item = prepare_conversation(OpaConversation(
        source_id="opa-weak-source",
        department="Suporte",
        messages=[
            OpaMessage(role="customer", content="Oi, minha internet caiu"),
            OpaMessage(role="agent", content="Oi! Vou olhar isso com você. A luz vermelha apareceu no aparelho?"),
        ],
    ), SALT)[0]
    assessment = assess_humanization_auto_learning(
        item,
        semantic_compatibility=0.98,
        source_compatibility=0.89,
        replay_passed=True,
        conflict_free=True,
    )
    assert assessment.eligible is False
    assert "source_compatibility_below_90" in assessment.rejection_reasons


def test_auto_learning_rejects_operational_content_even_with_high_compatibility() -> None:
    item = prepare_conversation(OpaConversation(
        source_id="opa-operational",
        department="Suporte",
        messages=[
            OpaMessage(role="customer", content="Minha internet caiu"),
            OpaMessage(role="agent", content="Vou abrir uma ordem de serviço para você."),
        ],
    ), SALT)[0]
    assessment = assess_humanization_auto_learning(
        item,
        semantic_compatibility=0.98,
        source_compatibility=0.98,
        replay_passed=True,
        conflict_free=True,
    )
    assert assessment.eligible is False
    assert "operational_or_commercial_content" in assessment.rejection_reasons
