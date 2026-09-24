"""Pipeline /reply: parse [HANDOFF], heuristica, RAG mock e fail-safe."""

from __future__ import annotations

import pytest

from src import retrieval
from src.config import get_settings
from src.handoff import parse_llm_reply
from src.retrieval import RetrievedChunk
from src.routes.reply import (
    _is_los_signal_issue,
    _is_recurrence_after_visit,
    _latest_customer_turn_text,
    _polish_customer_reply,
    _retrieval_limit,
    _sales_qualification_next_step,
    _select_operational_skill,
)
from src.schemas import OperationalSkillIn
from src.triage import TriageResult

AUTH_BODY_BASE = {
    "org_id": "org_1",
    "conversation_id": "conv_1",
    "contact": {"name": "Ana"},
}


def test_customer_reply_removes_redundant_confirmation_question() -> None:
    reply = _polish_customer_reply(
        "A lentidão acontece nos dois celulares, certo? Em quais horários ela piora?"
    )
    assert reply.count("?") == 1
    assert "certo?" not in reply
    assert "Em quais horários" in reply


def test_sales_state_advances_without_a_matching_rag_skill() -> None:
    reply = _sales_qualification_next_step(
        [],
        "Cavalhada II, Cáceres",
        None,
        {"nextStep": "ASK_ADDRESS", "coverageCheckStatus": "NOT_CHECKED"},
    )

    assert reply is not None
    assert "localização" in reply
    assert "CEP" in reply


@pytest.mark.parametrize("status", ["CONFIRMED", "NOT_AVAILABLE", "INCONCLUSIVE", "REVIEW_REQUIRED"])
def test_sales_does_not_ask_for_location_after_official_coverage_result(status: str) -> None:
    reply = _sales_qualification_next_step(
        [], "Quero um plano de internet", None,
        {"nextStep": "ASK_ADDRESS", "coverageCheckStatus": status},
    )
    assert reply is None


def test_los_light_that_turned_off_is_not_treated_as_active_optical_loss() -> None:
    assert _is_los_signal_issue("A luz LOS está vermelha") is True
    assert _is_los_signal_issue("A luz LOS está piscando") is True
    assert _is_los_signal_issue("A luz LOS apagou agora, mas a internet está lenta") is False


def test_support_continues_when_wired_test_is_not_available(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_skills": [
            {
                "key": "support-core-diagnosis",
                "name": "Diagnóstico técnico",
                "version": 1,
                "route_key": "technical_support",
                "allowed_actions": ["guide_safe_troubleshooting"],
                "minimum_confidence": 0.9,
            },
        ],
        "operational_context": {
            "identity_verified": True,
            "previous_intent": "technical_support",
            "continued_from_previous": True,
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "A luz LOS apagou, mas a internet ficou lenta nos dois celulares, mesmo perto do roteador."},
            {"role": "assistant", "content": "Você consegue testar em um computador ligado no cabo?"},
            {"role": "user", "content": "Não tenho computador ligado no cabo neste momento."},
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "sem o teste por cabo" in response["reply"]
    assert "responsável" not in response["reply"]


def test_wired_test_continuation_reuses_reported_light_status(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_skills": [
            {
                "key": "support-core-diagnosis",
                "name": "Diagnóstico técnico",
                "version": 1,
                "route_key": "technical_support",
                "allowed_actions": ["guide_safe_troubleshooting"],
                "minimum_confidence": 0.9,
            },
        ],
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "planned_actions": ["connections"],
            "previous_intent": "technical_support",
            "continued_from_previous": True,
            "triage_confidence": 0.9,
        },
        "messages": [
            {
                "role": "user",
                "content": "A internet está lenta nos dois celulares e na TV. Já reiniciei o roteador e não há luz vermelha.",
            },
            {"role": "assistant", "content": "Pode confirmar os dados do cadastro?"},
            {
                "role": "user",
                "content": "Não tenho computador no cabo. A luz de internet está piscando.",
            },
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert "já informou que não há luz vermelha" in response["reply"]
    assert "luz de internet está piscando" in response["reply"]
    assert "você percebe se alguma luz" not in response["reply"].lower()


def test_wired_test_continuation_recognizes_los_that_turned_off(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_skills": [{
            "key": "support-core-diagnosis", "name": "Diagnóstico técnico", "version": 1,
            "route_key": "technical_support", "allowed_actions": ["guide_safe_troubleshooting"],
            "minimum_confidence": 0.9,
        }],
        "operational_context": {
            "identity_verified": False, "planned_actions": ["connections"],
            "previous_intent": "technical_support", "continued_from_previous": True,
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "Mais cedo a luz LOS ficou vermelha, mas apagou. A internet continua lenta nos dois celulares e na TV."},
            {"role": "assistant", "content": "Pode confirmar os dados do cadastro?"},
            {"role": "user", "content": "Não tenho computador no cabo. A luz LOS continua apagada e a internet fica piscando."},
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert "a luz los apagou e a luz de internet está piscando" in response["reply"].lower()
    assert "você percebe se alguma luz" not in response["reply"].lower()


def test_customer_reply_keeps_only_one_diagnostic_question() -> None:
    reply = _polish_customer_reply(
        "Existe evento coletivo na região? Você percebeu se a luz ficou vermelha agora ou antes?"
    )
    assert reply == "Você percebeu se a luz ficou vermelha agora ou antes?"


def test_recurrence_after_technical_visit_requires_review() -> None:
    assert _is_recurrence_after_visit(
        "O técnico veio ontem e hoje a mesma falha voltou novamente."
    )
    assert not _is_recurrence_after_visit("A internet caiu hoje pela primeira vez.")


def test_recurrence_after_visit_requests_identity_before_any_handoff(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_skills": [{
            "key": "support-ticket-status", "name": "Status de chamado", "version": 1,
            "route_key": "technical_support", "allowed_actions": ["read_ticket_status"],
            "minimum_confidence": 0.9,
        }],
        "operational_context": {
            "identity_verified": False, "identity_required_now": True, "planned_actions": ["tickets", "service_orders"],
            "triage_confidence": 0.9,
        },
        "messages": [{
            "role": "user",
            "content": (
                "Um técnico veio ontem, mas hoje a mesma falha voltou. A internet cai nos dois celulares e na TV. "
                "Você consegue verificar se já existe chamado ou ordem de serviço aberta?"
            ),
        }],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert "CPF completo" in response["reply"]
    assert "responsável" not in response["reply"].lower()


def test_customer_reply_removes_unbacked_proactive_notification_promise() -> None:
    reply = _polish_customer_reply(
        "Há uma instabilidade coletiva na região. Assim que tiver uma atualização, te aviso por aqui."
    )
    assert reply == "Há uma instabilidade coletiva na região."


def test_customer_reply_removes_report_formatting_without_touching_protocol_code() -> None:
    reply = _polish_customer_reply(
        "Entendi — encontrei os registros abaixo:\n- Protocolo SEEG-02BCE2061B7A\n- OS 238587"
    )
    assert "—" not in reply
    assert "\n- " not in reply
    assert "SEEG-02BCE2061B7A" in reply
    assert "OS 238587" in reply


def test_customer_reply_removes_markdown_heading_and_bold() -> None:
    reply = _polish_customer_reply("### Atualização\n**A conexão** está em análise.")
    assert "###" not in reply
    assert "**" not in reply
    assert reply == "Atualização\nA conexão está em análise."


def test_retrieval_limit_uses_three_chunks_for_short_confident_question() -> None:
    triage = TriageResult("billing", "financial", 0.9)
    assert _retrieval_limit("Qual o vencimento da fatura?", triage, 6) == 3


def test_retrieval_limit_expands_for_long_or_uncertain_question() -> None:
    uncertain = TriageResult("general_support", "unrouted", 0.4)
    assert _retrieval_limit("Não sei explicar o problema", uncertain, 6) == 6
    confident = TriageResult("technical_support", "support", 0.9)
    assert _retrieval_limit("x" * 240, confident, 6) == 6


def test_retrieval_limit_never_exceeds_configuration() -> None:
    uncertain = TriageResult("general_support", "unrouted", 0.1)
    assert _retrieval_limit("Pedido ambíguo", uncertain, 2) == 2


def test_operational_skill_prefers_exact_route_and_latest_version() -> None:
    skills = [
        OperationalSkillIn(key="global", name="Global", version=1),
        OperationalSkillIn(key="support", name="Suporte", version=1, route_key="technical_support"),
        OperationalSkillIn(key="support", name="Suporte", version=2, route_key="technical_support"),
    ]
    selected = _select_operational_skill(skills, "technical_support")
    assert selected is not None
    assert selected.key == "support"
    assert selected.version == 2


def test_operational_skill_uses_global_fallback() -> None:
    global_skill = OperationalSkillIn(key="global", name="Global", version=1)
    assert _select_operational_skill([global_skill], "sales") == global_skill


def test_operational_skill_uses_question_trigger_within_same_department() -> None:
    skills = [
        OperationalSkillIn(
            key="slow-connection", name="Lentidão", version=1,
            route_key="technical_support", trigger_conditions=["internet lenta"],
        ),
        OperationalSkillIn(
            key="no-connection", name="Sem conexão", version=1,
            route_key="technical_support", trigger_conditions=["sem conexão"],
        ),
    ]
    selected = _select_operational_skill(
        skills, "technical_support", "Estou completamente sem conexão"
    )
    assert selected is not None
    assert selected.key == "no-connection"


def test_support_defaults_to_safe_diagnosis_before_action_skill() -> None:
    skills = [
        OperationalSkillIn(
            key="support-connectivity-ticket", name="Abertura de chamado", version=1,
            route_key="technical_support", trigger_conditions=["sem internet"],
            allowed_actions=["request_ticket"], protocol_steps=["Preparar chamado"],
        ),
        OperationalSkillIn(
            key="support-core-diagnosis", name="Diagnóstico", version=1,
            route_key="technical_support", trigger_conditions=["falha técnica"],
            allowed_actions=["guide_safe_troubleshooting"], protocol_steps=["Fazer um teste seguro"],
        ),
    ]

    selected = _select_operational_skill(
        skills, "technical_support", "Estou sem internet desde cedo."
    )

    assert selected is not None
    assert selected.key == "support-core-diagnosis"


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
    assert body["sources"] == ["policy:handoff:pedido_de_atendimento_humano"]


def test_identity_unavailable_offers_location_then_address(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "planned_actions": ["connections"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet"},
            {"role": "assistant", "content": "Me mande os dados do cadastro."},
            {"role": "user", "content": "[Valida\u00e7\u00e3o temporariamente indispon\u00edvel]"},
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["reply"] == (
        "Para confirmar o cadastro, compartilhe sua localização pelo clipe. "
        "Se preferir, envie o CEP e o número do endereço."
    )
    assert "�" not in response["reply"]


@pytest.mark.parametrize(
    ("message", "route_key"),
    [
        ("Preciso da segunda via da minha fatura", "billing"),
        ("Quero conhecer os planos disponíveis", "sales"),
    ],
)
def test_non_pilot_departments_are_handed_off_before_identity_or_rag(
    client, auth_headers, monkeypatch, message, route_key
) -> None:
    searched = False

    def search(*args, **kwargs):
        nonlocal searched
        searched = True
        return []

    monkeypatch.setattr(retrieval, "search", search)
    body = _reply(client, auth_headers, message).json()

    assert body["handoff"] is True
    assert body["handoff_reason"] == "setor_fora_do_piloto"
    assert body["route_key"] == route_key
    assert body["reply"] is None
    assert searched is False


@pytest.mark.parametrize(
    ("message", "reason"),
    [
        ("Acho que clonaram meu acesso e fizeram uma fraude", "risco_seguranca_ou_fraude"),
        ("Tem um fio pegando fogo no poste", "risco_ou_ameaca"),
    ],
)
def test_critical_safety_triggers_force_handoff(client, auth_headers, message, reason) -> None:
    body = _reply(client, auth_headers, message).json()
    assert body["handoff"] is True
    assert body["handoff_reason"] == reason


def test_explicit_recurrence_after_technical_visit_opens_technical_gap(client, auth_headers) -> None:
    body = _reply(
        client,
        auth_headers,
        "O técnico veio ontem, mas hoje a mesma lentidão voltou em todos os aparelhos.",
    ).json()
    assert body["handoff"] is True
    assert body["handoff_reason"] == "recorrencia_apos_atendimento_tecnico"
    assert body["route_key"] == "technical_support"


def test_non_pilot_billing_query_handoffs_before_identity_or_retrieval(client, auth_headers, monkeypatch) -> None:
    called = False

    def search(*args, **kwargs):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(retrieval, "search", search)
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "planned_actions": ["invoices", "contracts"],
            "previous_intent": "billing",
            "triage_confidence": 0.9,
        },
        "messages": [{"role": "user", "content": "Minha fatura está atrasada?"}],
    }
    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert response["handoff"] is True
    assert response["handoff_reason"] == "setor_fora_do_piloto"
    assert response["reply"] is None
    assert called is False


def test_identity_request_does_not_repeat_welcome_after_first_reply(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "planned_actions": ["connections"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet e a luz LOS está vermelha"},
            {"role": "assistant", "content": "Vou verificar isso com você."},
            {"role": "user", "content": "Continua sem internet e a luz LOS está vermelha"},
        ],
    }
    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert "CPF completo" in response["reply"]
    assert not response["reply"].startswith(("Olá!", "Oi!"))


def test_support_identity_gate_precedes_any_regional_question(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "planned_actions": ["connections", "service_orders", "tickets", "contracts", "fiber_access"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [{"role": "user", "content": "Minha internet parou."}],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "CPF" in response["reply"]
    assert "completo" in response["reply"]
    assert "vizinh" not in response["reply"].lower()


def test_initial_support_outage_keeps_the_identity_request_objective(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "planned_actions": ["connections", "service_orders", "tickets", "contracts", "fiber_access"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "Oie"},
            {"role": "assistant", "content": "Bom dia! Tudo bem? Como posso te ajudar?"},
            {"role": "user", "content": "Estou sem internet"},
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert "CPF" in response["reply"]
    assert "vizinh" not in response["reply"].lower()


def test_identity_attempt_never_becomes_gap(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {"identity_verified": False, "identity_required_now": True, "planned_actions": ["connections"], "previous_intent": "technical_support", "triage_confidence": 0.9},
        "messages": [
            {"role": "user", "content": "Estou sem internet e a luz LOS está vermelha."},
            {"role": "assistant", "content": "Me envie o CPF completo do titular."},
            {"role": "user", "content": "12345678901"},
        ],
    }
    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert response["handoff"] is False
    assert "Não localizei" in response["reply"]


def test_identity_unavailable_keeps_simple_support_autonomous(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "planned_actions": ["connections"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet e a luz LOS está vermelha."},
            {"role": "assistant", "content": "Me envie o CPF completo do titular."},
            {"role": "user", "content": "[Validação temporariamente indisponível]"},
        ],
    }
    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "cabo de fibra" in response["reply"]
    assert "responsável" not in response["reply"]


@pytest.mark.parametrize(
    "deferment",
    (
        "Não estou com esses dados agora. Você consegue me orientar enquanto isso?",
        "Não tenho os dados em mãos agora, consegue me orientar?",
        "Não estou com meu CPF agora. O que posso fazer enquanto isso?",
        "Não sei de cabeça, vou procurar os dados e volto depois.",
        "Não consigo passar agora; posso informar mais tarde.",
        "Prefiro não enviar dados de cadastro agora. Só queria uma orientação para não piorar a situação enquanto acompanho por aqui.",
    ),
)
def test_support_keeps_safe_guidance_when_customer_defers_identity(client, auth_headers, deferment) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            # O planejamento pode já ter sido reduzido nesta segunda mensagem;
            # o histórico técnico, e não uma nova consulta, autoriza a orientação.
            "planned_actions": [],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
            "continued_from_previous": True,
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet e a luz LOS está vermelha."},
            {"role": "assistant", "content": "Me envie o CPF completo do titular."},
            {"role": "user", "content": deferment},
        ],
    }
    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "consultar a sua conexão" in response["reply"]
    assert "equipamento ligado" in response["reply"]
    assert "responsável" not in response["reply"]


def test_deferred_identity_never_invents_an_optical_alarm(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "planned_actions": [],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
            "continued_from_previous": True,
        },
        "messages": [
            {
                "role": "user",
                "content": "A conexão ficou ruim e não entendi uma informação técnica. Vou ficar sem internet até alguém ir aí?",
            },
            {"role": "assistant", "content": "Me envie o CPF completo do titular."},
            {"role": "user", "content": "Prefiro não informar meus dados agora, mas queria saber se existe alguma previsão."},
        ],
    }
    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "LOS está vermelha" not in response["reply"]
    assert "vermelha, piscando ou apagada" in response["reply"]


def test_initial_support_acknowledges_a_detailed_multi_device_report(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "planned_actions": ["connections"],
            "triage_confidence": 0.9,
        },
        "messages": [{
            "role": "user",
            "content": (
                "Minha internet ficou muito lenta nos dois celulares e na TV, mesmo perto do roteador. "
                "Já reiniciei o equipamento uma vez e não há luz vermelha."
            ),
        }],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert "mais de um aparelho" in response["reply"]
    assert "CPF completo" in response["reply"]
    assert "Vamos conferir isso juntos" not in response["reply"]


def test_initial_los_report_acknowledges_work_impact_without_promise(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "planned_actions": ["connections"],
            "triage_confidence": 0.9,
        },
        "messages": [{
            "role": "user",
            "content": "Estou sem internet, a luz LOS ficou vermelha e preciso trabalhar hoje. Já reiniciei o equipamento.",
        }],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert "precisando trabalhar hoje" in response["reply"]
    assert "prioridade" not in response["reply"].lower()
    assert "prazo" not in response["reply"].lower()


def test_initial_technical_diagnosis_does_not_request_identity_before_account_lookup(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_skills": [{
            "key": "support-core-diagnosis", "name": "Diagnóstico técnico", "version": 1,
            "route_key": "technical_support", "allowed_actions": ["guide_safe_troubleshooting"],
            "minimum_confidence": 0.9,
        }],
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": False,
            "planned_actions": ["connections", "service_orders", "tickets", "contracts"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [{
            "role": "user",
            "content": "Estou sem internet e a luz LOS está vermelha. Já reiniciei o equipamento uma vez.",
        }],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "cpf" not in response["reply"].lower()
    assert "mês" not in response["reply"].lower()
    assert "já reiniciou" in response["reply"].lower()
    assert "ficou assim agora" in response["reply"].lower()


def test_los_turning_off_moves_to_slowness_without_reusing_stale_identity_request(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_skills": [{
            "key": "support-core-diagnosis", "name": "Diagnóstico técnico", "version": 1,
            "route_key": "technical_support", "allowed_actions": ["guide_safe_troubleshooting"],
            "minimum_confidence": 0.9,
        }],
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": False,
            "planned_actions": ["connections", "service_orders", "tickets", "contracts"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
            "continued_from_previous": True,
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet e a luz LOS está vermelha. Já reiniciei o equipamento."},
            {"role": "assistant", "content": "Pode me informar o CPF completo do titular?"},
            {"role": "user", "content": "A luz LOS apagou agora, mas a internet ficou muito lenta nos dois celulares, mesmo perto do roteador."},
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "não está mais indicando falta de sinal óptico" in response["reply"].lower()
    assert "luz de internet está piscando" in response["reply"].lower()
    assert "cpf" not in response["reply"].lower()
    assert "nascimento" not in response["reply"].lower()


def test_structured_case_state_controls_the_next_safe_support_step(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_skills": [{
            "key": "support-core-diagnosis", "name": "Diagnóstico técnico", "version": 1,
            "route_key": "technical_support", "allowed_actions": ["guide_safe_troubleshooting"],
            "minimum_confidence": 0.9,
        }],
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": False,
            "case_state": {
                "route": "technical_support", "currentSymptom": "SLOWNESS", "losLight": "UNKNOWN",
                "affectedMultipleDevices": True, "nextStep": "ASK_LIGHT_STATE",
            },
            "planned_actions": ["connections"], "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [{
            "role": "user",
            "content": "A internet ficou lenta nos dois celulares, mesmo perto do roteador.",
        }],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["sources"] == ["policy:structured-case-state"]
    assert "luz do equipamento" in response["reply"].lower()
    assert "cpf" not in response["reply"].lower()


def test_blinking_internet_light_finishes_safe_diagnosis_without_identity_request(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_skills": [{
            "key": "support-core-diagnosis", "name": "Diagnóstico técnico", "version": 1,
            "route_key": "technical_support", "allowed_actions": ["guide_safe_troubleshooting"],
            "minimum_confidence": 0.9,
        }],
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": False,
            "case_state": {
                "route": "technical_support", "currentSymptom": "SLOWNESS", "losLight": "OFF",
                "internetLight": "BLINKING", "affectedMultipleDevices": True,
                "nextStep": "PROVIDE_STABILIZATION_GUIDANCE",
            },
            "planned_actions": ["connections"], "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet e a luz LOS ficou vermelha."},
            {"role": "assistant", "content": "Pode me passar o CPF completo do titular?"},
            {"role": "user", "content": "A LOS apagou, mas continua lento nos dois celulares."},
            {"role": "assistant", "content": "A luz de internet está piscando ou fica apagada agora?"},
            {"role": "user", "content": "A luz de internet está piscando."},
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert response["sources"] == ["policy:structured-case-state"]
    assert "instabilidade" in response["reply"].lower()
    assert "cpf" not in response["reply"].lower()
    assert "nascimento" not in response["reply"].lower()


def test_deferred_identity_keeps_context_after_no_optical_alarm_confirmation(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
            "continued_from_previous": True,
        },
        "messages": [
            {
                "role": "user",
                "content": "A internet está lenta nos dois celulares e na TV. Já reiniciei o roteador uma vez.",
            },
            {"role": "assistant", "content": "Pode me mandar o CPF completo do titular?"},
            {"role": "user", "content": "Prefiro não enviar dados de cadastro agora; pode me orientar por enquanto?"},
            {"role": "assistant", "content": "A luz LOS está vermelha, piscando ou apagada?"},
            {
                "role": "user",
                "content": "Nenhuma luz está vermelha. A luz de internet pisca e as outras parecem normais.",
            },
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert "não precisa mexer nos cabos" in response["reply"]
    assert "perto do roteador" not in response["reply"]
    assert "situação específica da sua conexão" in response["reply"]


def test_optical_alarm_confirmation_after_identity_unavailable_is_direct(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "planned_actions": ["connections", "service_orders", "tickets", "contracts", "fiber_access"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet"},
            {"role": "assistant", "content": "Me mande os dados do cadastro."},
            {"role": "user", "content": "[Valida\u00e7\u00e3o temporariamente indispon\u00edvel]"},
            {"role": "assistant", "content": "Essa luz vermelha é a de sinal, às vezes chamada LOS ou PON?"},
            {"role": "user", "content": "Sim, essa mesma"},
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert "perda de sinal" in response["reply"].lower()
    assert "equipamento ligado" in response["reply"].lower()
    assert "n�o vou te pedir os dados" not in response["reply"].lower()
    assert "sem confirmar o cadastro" not in response["reply"].lower()


def test_phone_not_found_offers_location_before_address(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "identity_phone_candidate_status": "no_candidate",
            "planned_actions": ["connections"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
        },
        "messages": [{"role": "user", "content": "Estou sem internet"}],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "CPF completo" in response["reply"]
    assert "IXC" not in response["reply"]


def test_consecutive_messages_keep_support_route_before_first_reply(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "identity_phone_candidate_status": "no_candidate",
            "planned_actions": ["connections", "contracts"],
        },
        "messages": [
            {"role": "user", "content": "Oi"},
            {"role": "user", "content": "Estou sem internet"},
            {"role": "user", "content": "Faz muito tempo"},
        ],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["route_key"] == "technical_support"
    assert "CPF completo" in result["reply"]
    assert "LOS" not in result["reply"]
    assert "Ainda não tenho uma informação segura" not in result["reply"]


def test_consecutive_messages_survive_identity_marker_for_regional_check(client, auth_headers) -> None:
    body = _support_outage_body(connection_active=True)
    body["operational_context"]["case_state"] = None
    body["messages"] = [
        {"role": "user", "content": "Oi"},
        {"role": "user", "content": "Estou sem internet"},
        {"role": "user", "content": "Faz muito tempo"},
        {"role": "assistant", "content": "Me envie o CPF completo do titular para conferir seu acesso."},
        {"role": "user", "content": "[Identidade validada com segurança]"},
    ]
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["route_key"] == "technical_support"
    assert result["reply"].startswith("Não encontrei ocorrência coletiva confirmada")


@pytest.mark.parametrize(
    ("messages", "route", "planned_actions", "identity_required", "expected"),
    [
        (["Oi", "Quero contratar internet", "Para minha casa"], "sales", [], False, "localização"),
        (["Oi", "Preciso da segunda via da minha fatura", "Vence hoje"], "billing",
         ["invoices", "contracts"], True, "CPF completo"),
    ],
)
def test_consecutive_messages_keep_sales_and_billing_routes(
    client, auth_headers, monkeypatch, messages, route, planned_actions, identity_required, expected
) -> None:
    monkeypatch.setenv("PILOT_ROUTE_KEYS", "technical_support,billing,sales")
    get_settings.cache_clear()
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": identity_required,
            "identity_phone_candidate_status": "no_candidate" if identity_required else None,
            "planned_actions": planned_actions,
            "case_state": {"route": "sales", "nextStep": "ASK_ADDRESS"} if route == "sales" else None,
        },
        "messages": [{"role": "user", "content": text} for text in messages],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["route_key"] == route
    assert result["handoff"] is False
    assert expected in result["reply"]


def test_initial_generic_clarification_still_greets_before_asking(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": False,
            "planned_actions": ["contracts"],
        },
        "messages": [
            {"role": "user", "content": "Oi"},
            {"role": "user", "content": "Preciso de ajuda"},
        ],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["route_key"] == "unrouted"
    assert result["reply"].startswith(("Bom dia! Tudo bem?\n\n", "Boa tarde! Tudo bem?\n\n", "Boa noite! Tudo bem?\n\n"))


def test_plain_oi_receives_a_natural_greeting(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {"identity_verified": False, "identity_required_now": False, "planned_actions": []},
        "messages": [{"role": "user", "content": "Oi"}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["reply"].startswith(("Bom dia! Tudo bem?", "Boa tarde! Tudo bem?", "Boa noite! Tudo bem?"))


@pytest.mark.parametrize("request_text", [
    "Estou sem internet", "Quero contratar internet", "Preciso da segunda via da minha fatura",
])
def test_identity_marker_recovers_full_consecutive_request_in_each_sector(request_text) -> None:
    from types import SimpleNamespace

    messages = [
        SimpleNamespace(role="user", content="Oi"),
        SimpleNamespace(role="user", content=request_text),
        SimpleNamespace(role="user", content="Faz muito tempo"),
        SimpleNamespace(role="assistant", content="Vou conferir seus dados."),
        SimpleNamespace(role="user", content="[Identidade validada com segurança]"),
    ]
    assert _latest_customer_turn_text(messages) == f"Oi\n{request_text}\nFaz muito tempo"


def test_location_identity_marker_precedes_general_support_reply(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            # Reproduz o estado após uma tentativa de localização: mesmo que o
            # planejador não refaça ações nesta mensagem, o marcador precisa
            # continuar a conversa de identificação, não virar orientação geral.
            "identity_required_now": False,
            "planned_actions": [],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
            "continued_from_previous": True,
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet"},
            {"role": "assistant", "content": "Compartilhe sua localização pelo clipe."},
            {"role": "user", "content": "[Localização recebida sem cadastro correspondente]"},
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "CEP" in response["reply"]
    assert "luz" not in response["reply"].lower()


def test_support_continues_after_identity_unavailable_without_repeating_factors(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "planned_actions": ["connections"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
            "continued_from_previous": True,
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet e a luz LOS está vermelha."},
            {"role": "assistant", "content": "Me envie o CPF completo do titular."},
            {"role": "user", "content": "[Validação temporariamente indisponível]"},
            {"role": "assistant", "content": "Confira se o cabo de fibra está bem encaixado."},
            {"role": "user", "content": "Continua igual, a luz ainda está vermelha."},
        ],
    }
    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "não vou te pedir os dados de novo" in response["reply"].lower()
    assert "CPF completo" not in response["reply"]


def test_expired_identity_factors_preserve_previous_support_route(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": False,
        "operational_context": {
            "identity_verified": False,
            "identity_required_now": True,
            "planned_actions": ["connections", "service_orders", "tickets", "contracts"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
            "continued_from_previous": True,
        },
        "messages": [
            {"role": "user", "content": "Minha internet caiu e a luz LOS está vermelha"},
            {"role": "assistant", "content": "Me manda os dados para confirmar sua identidade."},
            {"role": "user", "content": "12345678901"},
        ],
    }
    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert response["handoff"] is False
    assert response["route_key"] == "technical_support"
    assert "CPF completo" in response["reply"]


def test_verified_identity_marker_does_not_request_factors_again(client, auth_headers, monkeypatch) -> None:
    from src.routes import reply as reply_route

    chunks = [RetrievedChunk(content="A conexão deve ser consultada no IXC.", score=0.91, source_id="kb_support")]
    monkeypatch.setattr(retrieval, "search", lambda *args, **kwargs: chunks)
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_context": {
            "identity_verified": True,
            "planned_actions": ["connections"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
            "continued_from_previous": True,
            "evidence": {
                "status": "success",
                "facts": [{"kind": "connection", "status": "A"}],
            },
        },
        "messages": [
            {"role": "user", "content": "Estou sem internet e a luz LOS está vermelha"},
            {"role": "assistant", "content": "Vou confirmar seu cadastro."},
            {"role": "user", "content": "[Identidade validada com segurança]"},
        ],
    }
    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert "CPF completo" not in (response["reply"] or "")
    assert response.get("handoff_reason") == "verificacao_regional_indisponivel"
    assert "LOS" not in (response["reply"] or "")
    assert response["route_key"] == "technical_support"


def _support_outage_body(*, connection_active: bool, structural_status: str | None = "NOT_CONFIRMED",
                         restarted: bool = False) -> dict:
    context = {
        "identity_verified": True,
        "planned_actions": ["connections", "contracts", "service_orders", "tickets"],
        "previous_intent": "technical_support",
        "evidence": {
            "source": "IXC", "status": "success",
            "facts": [
                {"resource": "contracts", "fields": {"status": "A", "internetStatus": "CA"}},
                {"resource": "connections", "fields": {"active": connection_active, "online": False}},
            ],
        },
        "case_state": {"route": "technical_support", "currentSymptom": "OUTAGE",
                       "losLight": "RED", "equipmentRestarted": restarted},
    }
    if structural_status:
        context["structural_incident"] = {"status": structural_status}
    return {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_context": context,
        "messages": [
            {"role": "user", "content": "Minha internet não pega"},
            {"role": "assistant", "content": "A luz LOS está vermelha?"},
            {"role": "user", "content": "sim"},
            {"role": "assistant", "content": "Me envie o CPF do titular para buscar no IXC."},
            {"role": "user", "content": "[Identidade validada com segurança]"},
        ],
    }


def test_old_customer_with_inactive_login_is_not_told_regional_outage_was_checked(client, auth_headers) -> None:
    result = client.post("/reply", json=_support_outage_body(connection_active=False), headers=auth_headers).json()
    assert result["handoff"] is False
    assert "não confirmei uma conexão ativa" in result["reply"]
    assert "queda na região do endereço atual" in result["reply"]
    assert "já reiniciou" not in result["reply"].lower()
    assert "CPF completo" not in result["reply"]


def test_active_customer_gets_regional_result_before_one_local_question(client, auth_headers) -> None:
    result = client.post("/reply", json=_support_outage_body(connection_active=True), headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["reply"].startswith("Não encontrei ocorrência coletiva confirmada para sua conexão")
    assert "IXC" not in result["reply"]
    assert "não descarta totalmente" in result["reply"]
    assert result["reply"].count("?") == 1
    assert "LOS" in result["reply"]


def test_active_customer_with_unavailable_regional_check_is_not_told_no_outage(client, auth_headers) -> None:
    result = client.post(
        "/reply", json=_support_outage_body(connection_active=True, structural_status=None), headers=auth_headers
    ).json()
    assert result["handoff_reason"] == "verificacao_regional_indisponivel"
    assert "LOS" not in (result.get("reply") or "")


def test_verified_cpf_after_internet_stopped_reports_regional_check_before_los(client, auth_headers) -> None:
    body = _support_outage_body(connection_active=True)
    body["operational_context"]["case_state"] = None
    body["messages"] = [
        {"role": "user", "content": "Oi"},
        {"role": "assistant", "content": "Boa tarde! Tudo bem? Como posso te ajudar?"},
        {"role": "user", "content": "Estou bem e vc? Então, minha Internet parou de funcionar"},
        {"role": "assistant", "content": "Não localizei seu cadastro por este número. Me envie o CPF completo do titular."},
        {"role": "user", "content": "[Identidade validada com segurança]"},
    ]
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["reply"].startswith("Não encontrei ocorrência coletiva confirmada")
    assert "IXC" not in result["reply"]
    assert result["reply"].index("ocorrência coletiva") < result["reply"].index("LOS")


def test_internet_stopped_without_regional_evidence_does_not_ask_los(client, auth_headers) -> None:
    body = _support_outage_body(connection_active=True, structural_status=None)
    body["operational_context"]["case_state"] = None
    body["messages"] = [{"role": "user", "content": "Minha internet parou de funcionar"}]
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff_reason"] == "verificacao_regional_indisponivel"
    assert "LOS" not in (result.get("reply") or "")


def test_los_after_restart_requests_human_review_without_claiming_service_order(client, auth_headers) -> None:
    result = client.post(
        "/reply", json=_support_outage_body(connection_active=True, restarted=True), headers=auth_headers
    ).json()
    assert result["handoff"] is True
    assert result["handoff_reason"] == "avaliacao_tecnica_residencial"


def test_no_red_los_moves_to_device_scope_without_repeating_regional_result(client, auth_headers) -> None:
    body = _support_outage_body(connection_active=True)
    body["operational_context"]["case_state"]["losLight"] = "UNKNOWN"
    body["messages"] = [
        {"role": "user", "content": "Estou sem internet"},
        {"role": "assistant", "content": "Não encontrei ocorrência coletiva confirmada no IXC. "
         "Para checar se será necessária uma visita, a luz LOS está vermelha?"},
        {"role": "user", "content": "não"},
    ]
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["reply"] == "Entendi. A falta de internet acontece em todos os aparelhos ou só em um?"


def test_multiple_devices_without_red_los_requests_restart_then_review(client, auth_headers) -> None:
    body = _support_outage_body(connection_active=True)
    body["operational_context"]["case_state"]["losLight"] = "UNKNOWN"
    body["messages"] = [
        {"role": "user", "content": "Estou sem internet"},
        {"role": "assistant", "content": "Não encontrei ocorrência coletiva confirmada no IXC. "
         "Para checar se será necessária uma visita, a luz LOS está vermelha?"},
        {"role": "user", "content": "não"},
        {"role": "assistant", "content": "Entendi. A falta de internet acontece em todos os aparelhos ou só em um?"},
        {"role": "user", "content": "todos"},
    ]
    first = client.post("/reply", json=body, headers=auth_headers).json()
    assert first["handoff"] is False
    assert "30 segundos" in first["reply"]
    body["operational_context"]["case_state"].update(affectedMultipleDevices=True, equipmentRestarted=True)
    body["messages"].extend([
        {"role": "assistant", "content": first["reply"]},
        {"role": "user", "content": "já fiz e continua sem internet"},
    ])
    second = client.post("/reply", json=body, headers=auth_headers).json()
    assert second["handoff"] is True
    assert second["handoff_reason"] == "avaliacao_tecnica_multiplos_dispositivos"


def test_los_cleared_but_internet_still_down_does_not_claim_red_los(client, auth_headers) -> None:
    body = _support_outage_body(connection_active=True)
    body["messages"] = [
        {"role": "user", "content": "Estou sem internet e a LOS estava vermelha"},
        {"role": "assistant", "content": "A luz LOS apagou. A internet voltou?"},
        {"role": "user", "content": "não"},
    ]
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff_reason"] == "avaliacao_tecnica_sinal_restabelecido"


def test_verified_identity_does_not_invoke_model_for_outage_without_regional_evidence(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import reply as reply_route

    class _ContradictingProvider:
        name = "test"

        def __init__(self) -> None:
            self.calls = 0

        def generate(self, messages, system):  # noqa: ANN001
            self.calls += 1
            if self.calls == 1:
                return "[HANDOFF] não foi possível validar a identidade pelo CPF"
            return "A conexão foi consultada e já existe um chamado técnico aberto."

    chunks = [RetrievedChunk(content="Consulte a conexão no IXC.", score=0.91, source_id="kb_support")]
    monkeypatch.setattr(retrieval, "search", lambda *args, **kwargs: chunks)
    provider = _ContradictingProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda *args, **kwargs: provider)
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_context": {
            "identity_verified": True,
            "planned_actions": ["connections", "tickets"],
            "evidence": {"status": "success", "facts": [{"kind": "ticket", "status": "open"}]},
        },
        "messages": [{"role": "user", "content": "Continuo sem internet e a luz LOS está vermelha"}],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert provider.calls == 0
    assert response["handoff_reason"] == "verificacao_regional_indisponivel"
    assert "LOS" not in (response.get("reply") or "")


def test_ticket_existence_does_not_handoff_only_because_schedule_is_missing(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import reply as reply_route

    class _OverreachingProvider:
        name = "test"

        def __init__(self) -> None:
            self.calls = 0

        def generate(self, messages, system):  # noqa: ANN001
            self.calls += 1
            if self.calls == 1:
                return "[HANDOFF] não há data de agendamento nas evidências"
            return "Já existe um chamado técnico aberto para essa falta de conexão."

    chunks = [RetrievedChunk(content="Consulte chamados no IXC.", score=0.91, source_id="kb_support")]
    monkeypatch.setattr(retrieval, "search", lambda *args, **kwargs: chunks)
    provider = _OverreachingProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda *args, **kwargs: provider)
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_context": {
            "identity_verified": True,
            "planned_actions": ["service_orders", "tickets"],
            "evidence": {"status": "success", "facts": [{"resource": "tickets", "fields": {"status": "A"}}]},
        },
        "messages": [{"role": "user", "content": "Já existe algum chamado aberto?"}],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()
    assert provider.calls == 2
    assert response["handoff"] is False
    assert "chamado técnico aberto" in response["reply"]


def test_safe_support_retries_generic_model_handoff_once(client, auth_headers, monkeypatch) -> None:
    from src.routes import reply as reply_route

    class _RoutineHandoffProvider:
        name = "test"

        def __init__(self) -> None:
            self.calls = 0

        def generate(self, messages, system):  # noqa: ANN001
            self.calls += 1
            if self.calls == 1:
                return "[HANDOFF] baixa confiança para responder"
            return "Entendi. Vamos seguir por aqui: alguma luz do equipamento está vermelha ou piscando diferente agora?"

    monkeypatch.setattr(retrieval, "search", lambda *args, **kwargs: [])
    provider = _RoutineHandoffProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda *args, **kwargs: provider)
    body = {
        **AUTH_BODY_BASE,
        "operational_skills": [{
            "key": "support-core-diagnosis", "name": "Diagnóstico", "version": 1,
            "route_key": "technical_support", "protocol_steps": ["Aplicar um teste seguro"],
            "allowed_actions": ["guide_safe_troubleshooting"], "minimum_confidence": 0.9,
        }],
        "operational_context": {
            "previous_intent": "technical_support",
            "continued_from_previous": True,
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "A internet está lenta nos dois celulares mesmo perto do roteador."},
        ],
    }

    response = client.post("/reply", json=body, headers=auth_headers).json()

    assert provider.calls == 2
    assert response["handoff"] is False
    assert "luz do equipamento" in response["reply"]


def test_context_below_autonomous_threshold_forces_handoff(client, auth_headers, monkeypatch) -> None:
    chunks = [RetrievedChunk(content="Contexto parcial.", score=0.6, source_id="src_partial")]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    body = _reply(client, auth_headers, "Qual é o prazo para resolver isso?").json()
    assert body["handoff"] is True
    assert body["handoff_reason"] == "baixa_confianca_para_resposta_automatica"
    assert body["confidence"] == pytest.approx(0.6)


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
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)

    response = _reply(client, auth_headers, "Qual o prazo de entrega para São Paulo?")
    assert response.status_code == 200
    body = response.json()
    assert body["handoff"] is False
    assert body["reply"] == "O prazo de entrega para São Paulo é de 3 dias úteis."
    assert body["confidence"] == pytest.approx(0.91)
    assert body["sources"] == ["src_entregas"]


def test_reply_without_context_is_handoff(client, auth_headers, monkeypatch) -> None:
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    response = _reply(client, auth_headers, "Qual o prazo de entrega?")
    body = response.json()
    assert body["handoff"] is True
    assert body["handoff_reason"] == "sem_contexto_na_base_de_conhecimento"


def test_ambiguous_request_is_clarified_before_handoff(client, auth_headers, monkeypatch) -> None:
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    response = _reply(client, auth_headers, "Preciso de ajuda")
    body = response.json()
    assert body["handoff"] is False
    assert body["clarification"] is True
    assert body["conversation_level"] == "investigativo"
    assert body["reply"].endswith("?")


def test_clarification_limit_prevents_endless_questions(client, auth_headers, monkeypatch) -> None:
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    body = {
        **AUTH_BODY_BASE,
        "clarification_count": 2,
        "messages": [{"role": "user", "content": "Preciso de ajuda"}],
    }
    response = client.post("/reply", json=body, headers=auth_headers)
    assert response.json()["handoff"] is True
    assert response.json()["handoff_reason"] == "sem_contexto_na_base_de_conhecimento"


def test_reply_with_unrelated_context_returns_llm_handoff(client, auth_headers, monkeypatch) -> None:
    chunks = [
        RetrievedChunk(content="Política de trocas: 30 dias.", score=0.4, source_id="src_trocas")
    ]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    response = _reply(client, auth_headers, "Vocês fazem instalação de ar condicionado?")
    body = response.json()
    assert body["handoff"] is True
    assert body["reply"] is None


def test_low_relevance_context_is_rejected_before_llm(client, auth_headers, monkeypatch) -> None:
    chunks = [RetrievedChunk(content="Informação não relacionada.", score=0.44, source_id="src_x")]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    response = _reply(client, auth_headers, "Qual o prazo de entrega?")
    assert response.json()["handoff"] is True
    assert response.json()["sources"] == ["policy:handoff:sem_contexto_na_base_de_conhecimento"]


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


def test_contextual_thanks_closes_without_rag_or_handoff(client, auth_headers, monkeypatch) -> None:
    called = False

    def search(*args, **kwargs):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(retrieval, "search", search)
    body = {
        **AUTH_BODY_BASE,
        "messages": [
            {"role": "user", "content": "Preciso da segunda via da fatura"},
            {"role": "assistant", "content": "Enviei a segunda via para você."},
            {"role": "user", "content": "Deu certo, obrigado"},
        ],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["confidence"] == 1.0
    assert result["sources"] == ["policy:closing"]
    assert "Grupo SEEG" not in result["reply"]
    assert called is False


def test_support_closing_with_return_keeps_support_route(client, auth_headers) -> None:
    body = {
        **AUTH_BODY_BASE,
        "operational_context": {
            "identity_verified": False,
            "previous_intent": "technical_support",
            "continued_from_previous": True,
            "triage_confidence": 0.9,
        },
        "messages": [
            {"role": "user", "content": "Minha internet ficou lenta."},
            {"role": "assistant", "content": "Vamos verificar isso por aqui."},
            {"role": "user", "content": "Obrigado pelas orientações. Se continuar assim, retorno por aqui."},
        ],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["route_key"] == "technical_support"
    assert result["sources"] == ["policy:closing"]


# ---------------------------------------------------- memoria de longo prazo (CONTRACTS §15)
class _SpySystemPromptProvider:
    """Provider fake que so captura o `system` recebido, sem chamar rede nenhuma."""

    name = "spy"

    def __init__(self) -> None:
        self.captured_system: str | None = None

    def generate(self, messages, system):  # noqa: ANN001 — assinatura do ChatProvider
        self.captured_system = system
        return "Resposta qualquer, sem HANDOFF."


def test_only_matching_active_skill_reaches_system_prompt(
    client, auth_headers, monkeypatch
) -> None:
    from src.llm.prompts import OPERATIONAL_SKILL_END, OPERATIONAL_SKILL_START
    from src.routes import reply as reply_route

    chunks = [RetrievedChunk(content="Reinicie o equipamento uma vez.", score=0.91, source_id="kb_support")]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)
    body = {
        **AUTH_BODY_BASE,
        "operational_skills": [
            {
                "key": "support-basic",
                "name": "Suporte básico",
                "version": 2,
                "route_key": "technical_support",
                "allowed_sources": ["kb_support"],
                "protocol_steps": ["Confirmar o sintoma antes de orientar."],
                "minimum_confidence": 0.8,
            },
            {
                "key": "billing-basic",
                "name": "Financeiro básico",
                "version": 1,
                "route_key": "financial",
                "protocol_steps": ["REGRA_FINANCEIRA_NAO_DEVE_APARECER"],
            },
        ],
        "messages": [{"role": "user", "content": "Minha internet está sem conexão"}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert spy.captured_system is not None
    assert OPERATIONAL_SKILL_START in spy.captured_system
    assert OPERATIONAL_SKILL_END in spy.captured_system
    assert "Confirmar o sintoma" in spy.captured_system
    assert "REGRA_FINANCEIRA_NAO_DEVE_APARECER" not in spy.captured_system


def test_skill_source_allowlist_blocks_unapproved_rag_source(
    client, auth_headers, monkeypatch
) -> None:
    chunks = [RetrievedChunk(content="Conteúdo não aprovado.", score=0.99, source_id="kb_other")]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    body = {
        **AUTH_BODY_BASE,
        "operational_skills": [{
            "key": "support-basic",
            "name": "Suporte básico",
            "version": 1,
            "route_key": "technical_support",
            "allowed_sources": ["kb_support"],
        }],
        "messages": [{"role": "user", "content": "Minha internet está sem conexão"}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is True
    assert result["handoff_reason"] == "sem_contexto_na_base_de_conhecimento"


def test_approved_rag_symbol_accepts_governed_source(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import reply as reply_route

    chunks = [RetrievedChunk(
        content="Oriente um reinício elétrico simples e confirme o estado da luz LOS.",
        score=0.92,
        source_id="protocol-support-v2",
        source_meta={"governance": "APPROVED", "department": "technical_support"},
    )]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)
    body = {
        **AUTH_BODY_BASE,
        "operational_skills": [{
            "key": "support-core-diagnosis",
            "name": "Diagnóstico técnico seguro",
            "version": 1,
            "route_key": "technical_support",
            "allowed_sources": ["RAG_APPROVED"],
            "protocol_steps": ["Aplicar um teste seguro por vez"],
            "allowed_actions": ["guide_safe_troubleshooting"],
            "minimum_confidence": 0.9,
        }],
        "messages": [{"role": "user", "content": "Estou sem conexão"}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["sources"] == ["protocol-support-v2", "skill:support-core-diagnosis@1"]


def test_governed_sector_rag_uses_search_relevance_without_lowering_decision_confidence(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import reply as reply_route

    chunks = [RetrievedChunk(
        content="Na ausência de conexão, aplique somente testes seguros, um passo por vez.",
        score=0.30,
        source_id="rag_protocol_support_v2",
        source_meta={"governance": "APPROVED", "department": "technical_support"},
    )]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)
    body = {
        **AUTH_BODY_BASE,
        "operational_skills": [{
            "key": "support-core-diagnosis",
            "name": "Diagnóstico técnico seguro",
            "version": 1,
            "route_key": "technical_support",
            "allowed_sources": ["RAG_APPROVED"],
            "protocol_steps": ["Aplicar um teste seguro por vez"],
            "allowed_actions": ["guide_safe_troubleshooting"],
            "minimum_confidence": 0.9,
        }],
        "messages": [{"role": "user", "content": "Estou sem conexão"}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["confidence"] == pytest.approx(0.9)
    assert result["sources"] == ["rag_protocol_support_v2", "skill:support-core-diagnosis@1"]


def test_governed_rag_from_another_department_never_reaches_support(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import reply as reply_route

    chunks = [
        RetrievedChunk(
            content="Cobrança e pagamento.", score=0.99, source_id="rag_billing",
            source_meta={"governance": "APPROVED", "department": "billing"},
        ),
        RetrievedChunk(
            content="Diagnóstico de conexão.", score=0.30, source_id="rag_support",
            source_meta={"governance": "APPROVED", "department": "technical_support"},
        ),
    ]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)
    body = {
        **AUTH_BODY_BASE,
        "operational_skills": [{
            "key": "support-core-diagnosis", "name": "Diagnóstico", "version": 1,
            "route_key": "technical_support", "allowed_sources": ["RAG_APPROVED"],
            "protocol_steps": ["Diagnosticar"],
            "allowed_actions": ["guide_safe_troubleshooting"], "minimum_confidence": 0.9,
        }],
        "messages": [{"role": "user", "content": "Minha conexão está lenta"}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert "rag_billing" not in result["sources"]
    assert "rag_support" in result["sources"]
    assert spy.captured_system is not None
    assert "Cobrança e pagamento" not in spy.captured_system


def test_safe_diagnosis_skill_prevents_false_gap_without_rag(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import reply as reply_route

    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)
    body = {
        **AUTH_BODY_BASE,
        "operational_skills": [
            {
                "key": "support-connectivity-ticket",
                "name": "Abertura de chamado",
                "version": 1,
                "route_key": "technical_support",
                "trigger_conditions": ["Ausência total de conexão confirmada"],
                "protocol_steps": ["Preparar chamado"],
                "allowed_actions": ["request_ticket"],
                "minimum_confidence": 0.9,
            },
            {
                "key": "support-core-diagnosis",
                "name": "Diagnóstico técnico seguro",
                "version": 1,
                "route_key": "technical_support",
                "trigger_conditions": ["Ausência de conexão"],
                "protocol_steps": ["Aplicar um teste seguro por vez"],
                "allowed_actions": ["guide_safe_troubleshooting"],
                "minimum_confidence": 0.9,
            },
        ],
        "messages": [{"role": "user", "content": "Estou sem internet e a luz LOS está vermelha"}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert result["confidence"] == pytest.approx(0.9)
    assert result["selected_skill_key"] == "support-core-diagnosis"
    assert result["sources"] == ["skill:support-core-diagnosis@1"]


def test_verified_operational_evidence_is_isolated_and_can_answer_without_rag(
    client, auth_headers, monkeypatch
) -> None:
    from src.llm.prompts import OPERATIONAL_EVIDENCE_END, OPERATIONAL_EVIDENCE_START
    from src.routes import reply as reply_route

    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_context": {
            "identity_verified": True,
            "planned_actions": ["connections"],
            "previous_intent": "technical_support",
            "triage_confidence": 0.9,
            "evidence": {
                "source": "IXC",
                "status": "success",
                "observedAt": "2026-08-22T16:00:00Z",
                "facts": [{
                    "resource": "connections",
                    "entityRef": "30",
                    "fields": {"online": False, "active": True},
                }],
            },
        },
        "messages": [{"role": "user", "content": "Minha internet está online?"}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert "ixc:operational" in result["sources"]
    assert spy.captured_system is not None
    assert OPERATIONAL_EVIDENCE_START in spy.captured_system
    assert OPERATIONAL_EVIDENCE_END in spy.captured_system
    assert '"online": false' in spy.captured_system


def test_inconclusive_network_context_blocks_local_diagnosis_until_regional_check(client, auth_headers, monkeypatch) -> None:
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_skills": [{
            "key": "support-core-diagnosis", "name": "Diagnóstico técnico", "version": 1,
            "route_key": "technical_support", "allowed_actions": ["guide_safe_troubleshooting"],
            "minimum_confidence": 0.9,
        }],
        "operational_context": {
            "identity_verified": True,
            "planned_actions": ["connections"],
            "evidence": {
                "source": "IXC", "status": "success",
                "observedAt": "2026-08-31T20:00:00Z", "facts": [],
            },
            "network_context": {
                "status": "INCONCLUSIVE",
                "blocksSensitiveAutomation": True,
                "context": None,
                "reason": "olho_de_deus_indisponivel",
            },
        },
        "messages": [{"role": "user", "content": "Minha internet caiu e a luz LOS está vermelha. Já reiniciei o equipamento."}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is True
    assert result["handoff_reason"] == "servico_atual_nao_confirmado"
    assert "ocorrência coletiva" not in (result.get("reply") or "").lower()


def test_ixc_unavailable_blocks_local_diagnosis_until_regional_check(client, auth_headers, monkeypatch) -> None:
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_skills": [{
            "key": "support-core-diagnosis", "name": "Diagnóstico técnico", "version": 1,
            "route_key": "technical_support", "allowed_actions": ["guide_safe_troubleshooting"],
            "minimum_confidence": 0.9,
        }],
        "operational_context": {
            "identity_verified": True,
            "planned_actions": ["connections"],
            "evidence": {"source": "IXC", "status": "unavailable", "observedAt": "2026-09-09T15:00:00Z", "facts": []},
        },
        "messages": [{"role": "user", "content": "Minha internet caiu e a luz LOS está vermelha. Já reiniciei o equipamento."}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is True
    assert result["handoff_reason"] == "verificacao_regional_indisponivel"
    assert "LOS" not in (result.get("reply") or "")


def test_confirmed_regional_incident_is_reported_before_any_local_question(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import reply as reply_route

    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_context": {
            "identity_verified": True,
            "planned_actions": ["connections"],
            "evidence": {
                "source": "IXC", "status": "success",
                "observedAt": "2026-08-31T20:00:00Z", "facts": [],
            },
            "network_context": {
                "status": "RESOLVED",
                "blocksSensitiveAutomation": False,
                "context": {
                    "diagnosis": "COLLECTIVE_OUTAGE_CONFIRMED",
                    "safeForAutomaticReply": True,
                },
                "reason": "olt_e_correlacao_confirmam_falha_coletiva",
            },
            "regional_incident": {"status": "REGISTERED", "disposition": "OPENED"},
        },
        "messages": [{"role": "user", "content": "Minha internet caiu"}],
    }
    result = client.post("/reply", json=body, headers=auth_headers).json()
    assert result["handoff"] is False
    assert "instabilidade regional confirmada" in result["reply"].lower()
    assert "LOS" not in result["reply"]
    assert "IXC" not in result["reply"]
    assert spy.captured_system is None


def test_confirmed_regional_outage_stops_individual_diagnosis_after_registration(
    client, auth_headers, monkeypatch
) -> None:
    """Evento regional confirmado não pode virar nova OS ou questionário ao cliente."""
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_context": {
            "identity_verified": True,
            "planned_actions": ["connections"],
            "evidence": {
                "source": "IXC", "status": "success",
                "observedAt": "2026-09-21T12:00:00Z", "facts": [],
            },
            "network_context": {
                "status": "RESOLVED",
                "blocksSensitiveAutomation": False,
                "context": {
                    "diagnosis": "COLLECTIVE_OUTAGE_CONFIRMED",
                    "safeForAutomaticReply": True,
                },
                "reason": "olt_e_correlacao_confirmam_falha_coletiva",
            },
            "regional_incident": {"status": "REGISTERED", "disposition": "OPENED"},
        },
        "messages": [{"role": "user", "content": "Minha internet caiu e a luz LOS está vermelha."}],
    }

    result = client.post("/reply", json=body, headers=auth_headers).json()

    assert result["handoff"] is False
    assert "instabilidade regional confirmada" in result["reply"].lower()
    assert "ordem de serviço separada" in result["reply"].lower()
    assert "ficou assim agora" not in result["reply"].lower()


class _AlwaysHandoffProvider:
    name = "always-handoff"

    def __init__(self) -> None:
        self.captured_system: str | None = None
        self.captured_messages = None

    def generate(self, messages, system):  # noqa: ANN001
        self.captured_system = system
        self.captured_messages = messages
        return "[HANDOFF] divergencia_entre_relato_e_ixc"


def test_answered_gap_cannot_reopen_the_same_handoff_loop(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import reply as reply_route

    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: [])
    provider = _AlwaysHandoffProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: provider)
    body = {
        **AUTH_BODY_BASE,
        "identity_verified": True,
        "operational_context": {
            "identity_verified": True,
            "planned_actions": ["connections"],
            "evidence": {
                "source": "IXC", "status": "success",
                "observedAt": "2026-09-04T16:00:00Z",
                "facts": [{"resource": "connections", "fields": {"online": True}}],
            },
            "gap_resolution": {
                "gap_id": "gap_1",
                "reason": "divergencia_entre_relato_e_ixc",
                "guidance": (
                    "Faça uma verificação técnica. Não crie chamado real nesta homologação."
                ),
            },
        },
        "messages": [
            {"role": "user", "content": "A luz LOS continua vermelha"},
            {"role": "assistant", "content": "Vou confirmar esse ponto com o responsável."},
        ],
    }

    result = client.post("/reply", json=body, headers=auth_headers).json()

    assert result["handoff"] is False
    assert result["reply"]
    assert "homologação" not in result["reply"].lower()
    assert "chamado real" not in result["reply"].lower()
    assert result["sources"] == ["internal:reviewed-guidance"]
    assert provider.captured_system is not None
    assert "Não abra outro encaminhamento pelo mesmo motivo" in provider.captured_system
    assert provider.captured_messages[-1]["role"] == "user"
    assert "orientação interna revisada" in provider.captured_messages[-1]["content"]


def test_contact_memory_summary_is_injected_as_distinct_labeled_block(
    client, auth_headers, monkeypatch
) -> None:
    """CONTRACTS §15: `contact.memorySummary` (pode vir null) precisa chegar ao
    system prompt do LLM em /reply, num bloco DISTINTO do CONTEXTO (RAG) e do
    histórico da conversa, rotulado como referência — não instrução."""
    from src.llm.prompts import CONTACT_MEMORY_END, CONTACT_MEMORY_START
    from src.routes import reply as reply_route

    chunks = [
        RetrievedChunk(content="Prazo de entrega: 3 dias úteis.", score=0.9, source_id="src_1")
    ]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)

    body = {
        "org_id": "org_1",
        "conversation_id": "conv_1",
        "contact": {"name": "Ana", "memorySummary": "Cliente prefere WhatsApp à tarde."},
        "messages": [{"role": "user", "content": "Qual o prazo de entrega?"}],
    }
    response = client.post("/reply", json=body, headers=auth_headers)
    assert response.status_code == 200

    assert spy.captured_system is not None
    assert CONTACT_MEMORY_START in spy.captured_system
    assert CONTACT_MEMORY_END in spy.captured_system
    assert "Cliente prefere WhatsApp à tarde." in spy.captured_system
    # Distinto do CONTEXTO (RAG) — o mesmo prompt ainda carrega os dois blocos.
    assert "### CONTEXTO" in spy.captured_system


def test_null_contact_memory_summary_omits_the_block(
    client, auth_headers, monkeypatch
) -> None:
    from src.llm.prompts import CONTACT_MEMORY_START
    from src.routes import reply as reply_route

    chunks = [
        RetrievedChunk(content="Prazo de entrega: 3 dias úteis.", score=0.9, source_id="src_1")
    ]
    monkeypatch.setattr(retrieval, "search", lambda org_id, query, top_k=6, **_kwargs: chunks)
    spy = _SpySystemPromptProvider()
    monkeypatch.setattr(reply_route, "get_chat_provider", lambda: spy)

    response = _reply(client, auth_headers, "Qual o prazo de entrega?")
    assert response.status_code == 200
    assert spy.captured_system is not None
    assert CONTACT_MEMORY_START not in spy.captured_system
