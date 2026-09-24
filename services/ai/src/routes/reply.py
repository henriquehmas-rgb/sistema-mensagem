"""POST /reply — pipeline RAG com guardrails e deteccao de handoff.

Fail-safe absoluto: qualquer erro (DB, LLM, timeout) retorna 200 com
``handoff=true`` — NUNCA propaga excecao para o chamador (api NestJS).
"""

from __future__ import annotations

import logging
import json
import re

from fastapi import APIRouter

from .. import retrieval
from ..source_policy import conflicting_authoritative_facts
from ..config import get_settings
from ..closing import closing_kind, closing_message
from ..response_contracts import (
    response_contract,
    sales_coverage_evidence_consent_reply,
    sales_coverage_evidence_reply,
)
from ..conversation_style import (
    MAX_CLARIFICATIONS,
    clarification_question,
    contextual_search_query,
    conversation_level,
    first_contact_opening,
    greeting_reply,
    is_social_only_message,
    needs_clarification,
    semantic_search_text,
)
from ..handoff import HEURISTIC_HANDOFF_CONFIDENCE, detect_handoff, parse_llm_reply
from ..llm import ChatMessage, get_chat_provider
from ..llm.executor import generate_with_timeout
from ..llm.orchestrator import prepare_history_context
from ..llm.prompts import build_system_prompt
from ..llm.review import approve_reply, needs_model_review
from ..output_guard import inspect_reply
from ..schemas import OperationalSkillIn, ReplyRequest, ReplyResponse, TriageAnalyzeRequest, TriageAnalyzeResponse
from ..textutils import clamp01, normalize
from ..usage_tracker import usage_scope
from ..triage import TriageResult, detect_intent

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reply"])

_LLM_HANDOFF_CONFIDENCE = 0.8
_MIN_AUTONOMOUS_ANSWER_CONFIDENCE = 0.65


def _polish_customer_reply(text: str) -> str:
    """Remove vícios previsíveis sem alterar fatos nem a orientação principal."""
    polished = text.strip()
    # Resposta voltada ao cliente deve parecer uma conversa, não um trecho de
    # documentação. Não tocamos em hífens de códigos/identificadores (SEEG-123),
    # apenas em travessões e marcadores que estruturam listas.
    polished = re.sub(r"\s*[—–]\s*", ", ", polished)
    polished = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", polished)
    polished = re.sub(r"(?m)^\s{0,3}(?:[-*•]|\d{1,2}[.)])\s+", "", polished)
    polished = polished.replace("**", "")
    if polished.count("?") > 1:
        # Em diagnóstico, perguntas paralelas confundem a resposta do cliente.
        # Mantemos somente a última, que representa a ação mais recente do modelo.
        questions = list(re.finditer(r"[^.!?]*\?", polished, flags=re.DOTALL))
        for question in questions[:-1]:
            polished = polished.replace(question.group(0), "", 1)
        polished = re.sub(r"\s{2,}", " ", polished).strip()
    polished = re.sub(
        r"(?:^|(?<=[.!?])\s+)Assim que (?:eu )?tiver[^.!?]*(?:te aviso|aviso você|avisaremos)[^.!?]*[.!?]?",
        "",
        polished,
        flags=re.IGNORECASE,
    ).strip()
    polished = re.sub(r"[ \t]+\n", "\n", polished)
    return re.sub(r"\n{3,}", "\n\n", polished).strip()


def _is_los_signal_issue(question: str) -> bool:
    value = normalize(question)
    # "A luz LOS apagou" informa justamente que o alarme óptico cessou; não é
    # equivalente a LOS vermelha/acesa. Tratar ambos como a mesma condição
    # reinicia o diagnóstico e faz a conversa repetir a pergunta anterior.
    return "los" in value and any(term in value for term in ("vermelh", "pisc", "acesa"))


def _has_los_signal_issue_in_history(messages) -> bool:
    """Só usa a orientação óptica quando esse sintoma foi informado pelo cliente.

    Nunca inferimos uma LOS vermelha a partir de uma falha genérica, da intenção
    técnica ou de uma identidade pendente. Isso evita que uma regra de fallback
    injete um diagnóstico que não pertence à conversa atual.
    """
    return any(
        message.role == "user" and _is_los_signal_issue(message.content)
        for message in messages
    )


def _customer_confirmed_optical_alarm(messages) -> bool:
    """Reconhece a confirmação curta após a pergunta LOS/PON da própria IA."""
    last_user_index = next((index for index in range(len(messages) - 1, -1, -1)
                            if messages[index].role == "user"), None)
    if last_user_index is None:
        return False
    last_assistant = next((message for message in reversed(messages[:last_user_index])
                           if message.role == "assistant"), None)
    if not last_assistant or "los" not in normalize(last_assistant.content) or "?" not in last_assistant.content:
        return False
    return normalize(messages[last_user_index].content).strip().startswith(("sim", "isso", "essa", "a mesma"))


def _support_outage_step(payload: ReplyRequest, triage: TriageResult, question: str,
                         case_summary: str | None) -> ReplyResponse | None:
    """Decide a ordem factual do suporte antes do diagnóstico de equipamento.

    CPF localizado não equivale a serviço ativo. Ausência de evento confirmado
    também não equivale a prova de que não há queda na região.
    """
    context = payload.operational_context
    normalized_question = normalize(question)
    outage_reported = (
        any(term in normalized_question for term in (
            "sem internet", "internet caiu", "internet parou", "internet nao pega",
            "internet nao funciona", "sem conexao", "sem rede", "offline", "luz los",
        ))
        or (context.case_state or {}).get("currentSymptom") == "OUTAGE"
    )
    if not (
        triage.route_key == "technical_support"
        and payload.identity_verified
        and outage_reported
    ):
        return None

    if "connections" not in context.planned_actions:
        return _handoff("verificacao_regional_nao_executada", triage=triage, case_summary=case_summary)
    evidence = context.evidence or {}
    if context.gap_resolution:
        return None
    if evidence.get("source") != "IXC" or evidence.get("status") not in ("success", "empty"):
        return _handoff("verificacao_regional_indisponivel", triage=triage, case_summary=case_summary)
    facts = [fact for fact in evidence.get("facts", []) if isinstance(fact, dict)]
    contracts = [fact.get("fields") or {} for fact in facts if fact.get("resource") == "contracts"]
    connections = [fact.get("fields") or {} for fact in facts if fact.get("resource") == "connections"]
    if not contracts or not connections:
        return _handoff("servico_atual_nao_confirmado", triage=triage, case_summary=case_summary)
    active_contract = any(str(item.get("status") or "").upper() in ("A", "ATIVO", "ACTIVE") for item in contracts)
    active_connections = [item for item in connections if item.get("active") is True]

    def reply(text: str, source: str, *, clarification: bool = False) -> ReplyResponse:
        return ReplyResponse(
            reply=text, handoff=False, handoff_reason=None, confidence=0.95,
            sources=[source], intent="technical_support", route_key="technical_support",
            triage_confidence=triage.confidence, case_summary=case_summary,
            clarification=clarification, conversation_level="direto",
        )

    if not active_contract or not active_connections:
        asked_before = any(
            message.role == "assistant" and "essa internet esta no mesmo cpf" in normalize(message.content)
            for message in payload.messages[:-1]
        )
        if asked_before:
            return _handoff("cadastro_sem_conexao_ativa", triage=triage, case_summary=case_summary)
        return reply(
            "Encontrei seu cadastro, mas não confirmei uma conexão ativa vinculada a ele. "
            "Assim, ainda não consigo verificar queda na região do endereço atual. "
            "Essa internet está no mesmo CPF e endereço desse cadastro?",
            "policy:support-active-service-check", clarification=True,
        )

    structural = context.structural_incident or {}
    if structural.get("status") == "CONFIRMED":
        return _handoff("ocorrencia_regional_confirmada_pendente_registro", triage=triage,
                        case_summary=case_summary)
    if structural.get("status") != "NOT_CONFIRMED":
        return _handoff("verificacao_regional_indisponivel", triage=triage, case_summary=case_summary)
    region_checked = structural.get("status") == "NOT_CONFIRMED"
    regional_result_already_sent = any(
        message.role == "assistant" and (
            "ocorrencia coletiva confirmada" in normalize(message.content)
            or "verificacao de queda geral na regiao" in normalize(message.content)
        ) for message in payload.messages
    )
    region = "" if regional_result_already_sent else (
        "Não encontrei ocorrência coletiva confirmada para sua conexão agora. "
        "Isso não descarta totalmente uma falha na rede. "
        if region_checked else
        "Ainda não consegui concluir a verificação de queda geral na região. "
    )
    online = [item.get("online") for item in active_connections]
    connection = "Sua conexão aparece desconectada no sistema. " if online and all(value is False for value in online) else ""
    state = context.case_state or {}
    los_red = state.get("losLight") == "RED" or _customer_confirmed_optical_alarm(payload.messages)
    last_assistant = next(
        (normalize(message.content) for message in reversed(payload.messages) if message.role == "assistant"), ""
    )
    last_user = next((normalize(message.content).strip() for message in reversed(payload.messages)
                      if message.role == "user"), "")
    yes = last_user in ("sim", "isso", "ja fiz", "fiz", "continua", "continua vermelha")
    no = last_user in ("nao", "ainda nao", "nunca", "nao fiz")
    restart_instructed = "desligue o equipamento da tomada por 30 segundos" in last_assistant
    restarted = state.get("equipmentRestarted") is True or (restart_instructed and yes)
    asked_los = any(
        message.role == "assistant" and "luz los esta vermelha" in normalize(message.content)
        for message in payload.messages
    )
    asked_devices = any(
        message.role == "assistant" and "todos os aparelhos ou so em um" in normalize(message.content)
        for message in payload.messages
    )
    multiple_devices = state.get("affectedMultipleDevices") is True or (
        "todos os aparelhos ou so em um" in last_assistant
        and last_user in ("todos", "em todos", "todos os aparelhos", "mais de um")
    )
    single_device = (
        "todos os aparelhos ou so em um" in last_assistant
        and last_user in ("um", "so um", "apenas um", "so no meu celular", "apenas no meu celular")
    )
    review_reason = (
        ("avaliacao_tecnica_residencial" if region_checked else "avaliacao_tecnica_regiao_inconclusiva")
        if los_red else
        ("avaliacao_tecnica_multiplos_dispositivos" if region_checked
         else "avaliacao_tecnica_multiplos_dispositivos_regiao_inconclusiva")
    )
    if "a internet voltou" in last_assistant:
        if yes:
            return reply("Ótimo, a conexão voltou. Se falhar novamente, me avise por aqui.",
                         "policy:support-recovered")
        if no:
            reason = (
                "avaliacao_tecnica_sinal_restabelecido" if region_checked
                else "avaliacao_tecnica_sinal_restabelecido_regiao_inconclusiva"
            ) if "a luz los apagou" in last_assistant else review_reason
            return _handoff(reason, triage=triage, case_summary=case_summary)
    if los_red and restarted:
        return _handoff(review_reason, triage=triage, case_summary=case_summary)
    if los_red:
        if restart_instructed and no:
            return reply(
                "A luz LOS apagou. A internet voltou?",
                "policy:support-recovery-check", clarification=True,
            )
        if no and "desligou" in last_assistant and "30 segundos" in last_assistant:
            return reply(
                "Desligue o equipamento da tomada por 30 segundos e ligue novamente. "
                "Depois disso, a luz LOS continua vermelha?",
                "policy:support-restart-guidance", clarification=True,
            )
        return reply(
            region + connection + "A luz LOS vermelha indica perda do sinal óptico no equipamento. "
            "Você já o desligou da tomada por 30 segundos e ligou novamente?",
            "policy:support-regional-before-local", clarification=True,
        )
    if single_device:
        return reply(
            region + "Como só um aparelho está sem acesso, teste desligar e ligar o Wi-Fi nele. "
            "Se continuar sem internet, me avise para seguirmos a verificação.",
            "policy:support-single-device", clarification=True,
        )
    if "teste desligar e ligar o wi-fi nele" in last_assistant:
        return _handoff(
            "avaliacao_tecnica_dispositivo" if region_checked else "avaliacao_tecnica_dispositivo_regiao_inconclusiva",
            triage=triage, case_summary=case_summary,
        )
    if not asked_los:
        return reply(
            region + connection + "Para checar se será necessária uma visita, a luz LOS está vermelha?",
            "policy:support-regional-before-local", clarification=True,
        )
    if not asked_devices:
        return reply(
            "Entendi. A falta de internet acontece em todos os aparelhos ou só em um?",
            "policy:support-device-scope", clarification=True,
        )
    if multiple_devices and restarted:
        return _handoff(review_reason, triage=triage, case_summary=case_summary)
    if multiple_devices:
        if no and "desligou o equipamento da tomada por 30 segundos" in last_assistant:
            return reply(
                "Desligue o equipamento da tomada por 30 segundos e ligue novamente. "
                "A internet voltou nos aparelhos?",
                "policy:support-restart-guidance", clarification=True,
            )
        return reply(
            "Você já desligou o equipamento da tomada por 30 segundos e ligou novamente?",
            "policy:support-restart-check", clarification=True,
        )
    return reply(
        "Não consegui identificar se ocorre em um ou em todos os aparelhos. Pode me dizer qual dos dois?",
        "policy:support-device-scope", clarification=True,
    )


def _unverified_technical_guidance(messages, *, identity_unavailable: bool = False) -> str:
    """Orientação segura sem consulta de conta, fundamentada apenas no histórico."""
    if identity_unavailable:
        if _has_los_signal_issue_in_history(messages):
            return (
                "A luz LOS vermelha indica perda de sinal. Deixe o equipamento ligado e evite mexer no cabo de fibra. "
                "Se ela mudar, me avise por aqui."
            )
        return "Para confirmar o cadastro, compartilhe sua localização pelo clipe. Se preferir, envie o CEP e o número do endereço."
    if _has_los_signal_issue_in_history(messages):
        if identity_unavailable:
            return (
                "Não consegui confirmar seu cadastro agora, mas dá para adiantar as verificações iniciais. "
                "Como a luz LOS está vermelha, confira se o cabo de fibra está bem encaixado e sem dobra forte. "
                "Se continuar igual, me avise que sigo com você por aqui."
            )
        return (
            "Sem confirmar o cadastro eu não consigo consultar a sua conexão, "
            "mas dá para seguir com uma orientação geral. Como a luz LOS está vermelha, "
            "mantenha o equipamento ligado e evite mexer no conector da fibra. "
            "Quando você tiver os dados, retomamos a consulta por aqui."
        )

    if identity_unavailable:
        return (
            "Não consegui confirmar seu cadastro agora, mas consigo seguir com uma orientação geral. "
            "Sem essa confirmação não vou consultar informações da conta. Você consegue observar se alguma luz no equipamento está vermelha, piscando ou apagada?"
        )
    return (
        "Sem confirmar o cadastro eu não consigo consultar a sua conexão nem informar uma previsão, "
        "mas posso seguir com uma orientação geral. Você consegue observar se alguma luz no equipamento está vermelha, piscando ou apagada?"
    )


def _wired_test_is_unavailable(question: str) -> bool:
    """Reconhece a impossibilidade do teste por cabo, sem tratar como GAP."""
    value = normalize(question)
    has_device = any(term in value for term in ("computador", "notebook", "pc"))
    has_cable = any(term in value for term in ("cabo", "cabeado", "ethernet", "wifi", "wi-fi"))
    has_unavailable = any(
        term in value
        for term in ("nao tenho", "não tenho", "sem", "nao consigo", "não consigo")
    )
    only_wifi = any(term in value for term in ("so uso wifi", "só uso wifi", "so pelo wifi", "só pelo wifi"))
    return has_cable and has_unavailable and (has_device or only_wifi or "teste" in value)


def _has_recent_multi_device_slowness(messages) -> bool:
    """Confirma que a conversa já descreveu lentidão em mais de um dispositivo."""
    history = " ".join(
        normalize(message.content)
        for message in messages[:-1]
        if message.role == "user"
    )
    is_slow = any(term in history for term in ("lenta", "lentidao", "instavel", "oscil"))
    multiple_devices = any(
        term in history
        for term in ("dois celulares", "dois aparelhos", "varios aparelhos", "mais de um aparelho")
    )
    return is_slow and multiple_devices


def _los_turned_off(text: str) -> bool:
    value = normalize(text)
    return "los" in value and any(
        phrase in value
        for phrase in ("los apagou", "los apagada", "los esta apagada", "los continua apagada")
    )


def _current_multi_device_slowness(text: str) -> bool:
    value = normalize(text)
    is_slow = any(term in value for term in ("lenta", "lentidao", "instavel", "oscil"))
    multiple_devices = any(
        term in value
        for term in ("dois celulares", "dois aparelhos", "mais de um aparelho", "todos os aparelhos")
    )
    return is_slow and multiple_devices


def _reports_internet_light(text: str) -> bool:
    value = normalize(text)
    return "internet" in value and any(term in value for term in ("luz", "led", "pisca", "piscando", "apagada"))


def _requests_identity_from_customer(text: str) -> bool:
    """Bloqueia pedidos de identificação que o modelo tente inventar fora do gate da API."""
    value = normalize(text)
    asks_for_factors = any(
        phrase in value
        for phrase in (
            "cpf completo", "seu cpf", "numero do cpf",
        )
    )
    asks_for_validation = any(
        phrase in value
        for phrase in ("confirmar sua identidade", "validar sua identidade", "confirmar seu cadastro")
    )
    return asks_for_factors or asks_for_validation


def _has_reported_non_optical_indicator(messages) -> bool:
    """Detecta quando o cliente já informou luzes normais e internet piscando."""
    history = " ".join(
        normalize(message.content)
        for message in messages
        if message.role == "user"
    )
    no_red_alarm = any(
        phrase in history
        for phrase in (
            "nenhuma luz esta vermelha",
            "nenhuma luz vermelha",
            "nao tem luz vermelha",
            "nao ha luz vermelha",
            "sem luz vermelha",
        )
    )
    los_is_off = _los_turned_off(history)
    internet_blinking = "internet" in history and any(
        term in history for term in ("pisca", "piscando", "piscou")
    )
    return (no_red_alarm or los_is_off) and internet_blinking


def _reported_light_status(messages) -> str:
    """Resume apenas um estado de luz explicitamente relatado pelo cliente."""
    history = " ".join(
        normalize(message.content)
        for message in messages
        if message.role == "user"
    )
    if _los_turned_off(history):
        return "a luz LOS apagou e a luz de internet está piscando"
    return "não há luz vermelha e a luz de internet está piscando"


def _initial_support_acknowledgement(question: str) -> str:
    """Acolhe o relato técnico com fatos já ditos, sem antecipar diagnóstico."""
    value = normalize(question)
    has_slowness = any(term in value for term in ("lenta", "lentidao", "lentidão", "travando", "oscil"))
    has_multiple_devices = sum(
        term in value for term in ("celular", "tv", "televis", "computador", "notebook", "aparelho")
    ) >= 2 or "todos os aparelhos" in value
    if has_slowness and has_multiple_devices and any(term in value for term in ("reinic", "desliguei", "liguei")):
        return (
            "Sinto muito pelo transtorno. Como a lentidão está acontecendo em mais de um aparelho mesmo depois de reiniciar o equipamento, "
            "vale olhar isso com calma. "
        )
    if _is_los_signal_issue(question):
        work_impact = any(term in value for term in ("trabalho", "trabalhar", "reuniao", "reunião", "enviar", "hoje"))
        if work_impact:
            return (
                "Entendo a preocupação, ainda mais precisando trabalhar hoje. Como a luz LOS ficou vermelha mesmo depois do reinício, "
                "vamos conferir isso com cuidado. "
            )
        return "Entendi. Você relatou perda de conexão junto com a luz LOS acesa. Vamos conferir isso com cuidado. "
    return ""


def _sales_qualification_next_step(
    messages,
    question: str,
    selected_skill: OperationalSkillIn | None,
    case_state: dict | None = None,
) -> str | None:
    """Mantém a descoberta comercial em uma sequência curta e previsível.

    A pessoa não deve receber, numa mesma conversa, pedidos de cidade, perfil,
    CPF ou disponibilidade fora de ordem. Esta camada só coleta contexto
    público; não consulta cadastro, não confirma cobertura e não cria proposta.
    """
    # A API persiste somente os marcos da qualificação, sem região nem
    # endereço. Quando a janela textual é curta, esse snapshot impede voltar a
    # perguntar se é residencial/empresa ou para que a conexão será usada.
    state_next_step = str((case_state or {}).get("nextStep") or "")
    coverage_evidence_requested = bool((case_state or {}).get("coverageEvidenceRequested"))
    coverage_check_status = str((case_state or {}).get("coverageCheckStatus") or "NOT_CHECKED")
    # A consulta oficial ja foi concluida. Estados legados podem ainda dizer
    # ASK_ADDRESS; nenhum deles deve reiniciar a coleta do local.
    if coverage_check_status != "NOT_CHECKED":
        return None
    state_replies = {
        "ASK_CUSTOMER_PROFILE": response_contract("sales.address").text,
        "ASK_PRIMARY_USAGE": response_contract("sales.usage").text,
        # Conversas iniciadas antes da mudança ainda podem carregar esse
        # marco. Elas migram direto para CEP+número, sem repetir cidade/bairro.
        "ASK_CITY_NEIGHBORHOOD": response_contract("sales.address").text,
        "ASK_ADDRESS": response_contract("sales.address").text,
        "REQUEST_COVERAGE_EVIDENCE": sales_coverage_evidence_reply(
            get_settings().ixc_inmap_auto_viability_public_url
        ),
    }
    if state_next_step in state_replies:
        return state_replies[state_next_step]
    # O estado persistido é a fonte de verdade para a próxima pergunta. A
    # ausência momentânea de uma habilidade RAG não pode fazer Vendas cair na
    # resposta genérica depois de receber uma região ou um endereço.
    if not selected_skill or selected_skill.key not in {
        "sales-plan-qualification", "sales-coverage-intake",
    }:
        return None
    user_messages = [message for message in messages if message.role == "user"]
    previous_assistant = next(
        (message.content for message in reversed(messages[:-1]) if message.role == "assistant"),
        "",
    )
    previous = normalize(previous_assistant)
    value = normalize(question)
    # Após o limite factual, uma confirmação inequívoca não pode voltar ao
    # modelo. O modelo não tem autorização nem dados estruturados para abrir a
    # prospecção IXC; ele também não deve transformar esse consentimento em
    # handoff. Encaminhamos somente o formulário público e canônico.
    consent_answers = {
        "sim", "pode", "pode sim", "pode seguir", "pode continuar",
        "pode verificar", "autorizo", "autorizo a consulta",
    }
    if (
        coverage_evidence_requested
        and coverage_check_status == "NOT_CHECKED"
        and value in consent_answers
    ):
        return sales_coverage_evidence_consent_reply(
            get_settings().ixc_inmap_auto_viability_public_url
        )
    if len(user_messages) == 1:
        if any(term in value for term in (
            "streaming", "netflix", "jogo", "gamer", "trabalho remoto", "home office",
        )):
            return response_contract("sales.address").text
        return response_contract("sales.usage").text
    if ("residencial" in value or "casa" in value or "empres" in value) and (
        "residencial" in previous or "empresa" in previous or "casa" in previous
    ):
        return response_contract("sales.address").text
    if any(term in value for term in ("streaming", "jogo", "trabalho remoto", "home office")) and any(
        term in previous for term in ("streaming", "jogos", "trabalho remoto", "necessidade")
    ):
        return response_contract("sales.address").text
    return None


def _follow_up_consent_reply(
    question: str, selected_skill: OperationalSkillIn | None
) -> str | None:
    """Converte um pedido de retorno em consentimento explícito, nunca em promessa.

    A sequência é criada somente pela API após uma resposta inequívoca do
    cliente. Esta pergunta usa a forma reconhecida pela política de follow-up
    e funciona igual nos três setores, sem enviar mensagem externa.
    """
    if not selected_skill or selected_skill.key not in {
        "support-follow-up-consent",
        "billing-follow-up-consent",
        "sales-follow-up-consent",
    }:
        return None
    if not any(term in normalize(question) for term in (
        "me avise", "me avisar", "me chama", "me chame", "me ligar", "retornar", "retorno", "acompanhar",
    )):
        return None
    return (
        "Posso retornar por aqui quando houver uma atualização? "
        "Se preferir não receber mensagens, é só me avisar."
    )


def _safe_support_handoff_can_retry(
    triage: TriageResult,
    selected_skill: OperationalSkillIn | None,
    handoff_reason: str | None,
) -> bool:
    """Permite uma única correção quando o modelo desiste de diagnóstico simples.

    A tentativa é limitada à skill resolutiva de Suporte. Regras determinísticas,
    fontes operacionais e cenários sensíveis já foram avaliados antes deste ponto;
    ainda assim, motivos que indicam risco, pessoa, preço ou ação externa nunca
    são rebaixados para uma resposta automática.
    """
    if (
        triage.route_key != "technical_support"
        or selected_skill is None
        or selected_skill.key != "support-core-diagnosis"
        or not _skill_can_resolve_procedurally(selected_skill, triage)
    ):
        return False
    blocked_terms = (
        "risco", "fraude", "golpe", "seguranca", "segurança", "humano",
        "atendente", "desconto", "preco", "preço", "valor", "pagamento",
        "cancel", "contrato", "agendamento", "visita", "prazo", "fonte",
        "indisponivel", "indisponível", "ambig", "dado sensivel", "dado sensível",
    )
    return not any(term in normalize(handoff_reason or "") for term in blocked_terms)


def _safe_public_information_handoff_can_retry(
    *,
    selected_skill: OperationalSkillIn | None,
    approved_general_financial_policy: bool,
    approved_general_sales_catalog: bool,
    handoff_reason: str | None,
) -> bool:
    """Permite uma única correção para informação pública já governada.

    A resposta só pode continuar quando a pipeline já confirmou uma skill
    específica e uma fonte aprovada. Isso não libera consulta de conta, preço
    individual, cobertura garantida, negociação ou escrita externa.
    """
    if not selected_skill or not (
        approved_general_financial_policy or approved_general_sales_catalog
    ):
        return False

    blocked_terms = (
        "fraude", "golpe", "seguranca", "segurança", "humano", "atendente",
        "cancelamento", "desconto", "negoci", "preco individual", "preço individual",
        "cobertura", "escrita", "externa", "pagamento individual",
    )
    return not any(term in normalize(handoff_reason or "") for term in blocked_terms)


def _safe_public_information_continuation(
    *,
    triage: TriageResult,
    selected_skill: OperationalSkillIn,
    approved_general_financial_policy: bool,
    best_context_score: float,
    case_summary: str | None,
) -> ReplyResponse:
    """Continuação sem LLM quando ele insiste em delegar informação pública.

    É um último recurso deliberadamente estreito. Não informa condição,
    desconto, preço, cobertura ou dado individual; apenas mantém a conversa
    útil até que seja necessária uma consulta protegida ou ação humana.
    """
    if approved_general_financial_policy:
        reply = response_contract("billing.general_policy").text
    else:
        reply = (
            "Posso seguir com as informações gerais dos planos publicados. "
            "Para te orientar pelo caminho certo, a internet é para casa ou para empresa? "
            "Depois verificamos a disponibilidade no endereço antes de avançar."
        )
    return ReplyResponse(
        reply=reply,
        handoff=False,
        handoff_reason=None,
        confidence=max(best_context_score, 0.60),
        sources=[
            "policy:safe-public-information-continuation",
            f"skill:{selected_skill.key}@{selected_skill.version}",
        ],
        intent=triage.intent,
        route_key=triage.route_key,
        triage_confidence=triage.confidence,
        secondary_intent=triage.secondary_intent,
        alternative_route_key=triage.alternative_route_key,
        conflict_detected=triage.conflict_detected,
        routing_evidence=list(triage.evidence),
        case_summary=case_summary,
        clarification=True,
        conversation_level="passo_a_passo",
        selected_skill_key=selected_skill.key,
        selected_skill_version=selected_skill.version,
    )


def _is_recurrence_after_visit(question: str) -> bool:
    value = normalize(question)
    had_technical_visit = any(term in value for term in ("tecnico veio", "visita tecnica", "atendimento tecnico", "tecnico esteve"))
    returned = any(term in value for term in ("voltou", "volto", "novamente", "de novo", "continua", "persist"))
    return had_technical_visit and returned


def _contradicts_verified_identity(reason: str | None) -> bool:
    """Detecta handoff do modelo que contradiz o estado validado pela API."""
    value = normalize(reason or "")
    return any(term in value for term in ("identidade", "cpf", "nascimento", "cadastro"))


def _stale_identity_assistant_turn(text: str) -> bool:
    """Descarta falas antigas que poderiam negar uma validação já confirmada."""
    value = normalize(text)
    return any(
        term in value
        for term in (
            "cpf",
            "mes do seu nascimento",
            "mes de nascimento",
            "confirmar sua identidade",
            "confirmar seu cadastro",
            "dados seguros",
            "validar com o responsavel",
            "confirmar esse ponto com o responsavel",
            "situacao precisa de uma atencao maior",
        )
    )


def _looks_like_identity_attempt(messages) -> bool:
    """Mantém a validação pendente fora do fluxo de GAP."""
    if len(messages) < 2 or messages[-1].role != "user":
        return False
    return (
        "cpf" in normalize(messages[-2].content)
        and len(re.sub(r"\D", "", messages[-1].content)) == 11
    )


def _has_identity_unavailable_marker(messages) -> bool:
    """Indica que a consulta protegida falhou, mas o suporte pode continuar."""
    return any(
        message.role == "user" and "[Validação temporariamente indisponível]" in message.content
        for message in messages[:-1]
    )


def _location_identity_status(question: str) -> str | None:
    if "[Localização recebida para confirmar o cadastro]" in question:
        return "candidate_ready"
    if "[Localização recebida sem cadastro correspondente]" in question:
        return "no_candidate"
    if "[Localização recebida; consulta de cadastro indisponível]" in question:
        return "unavailable"
    return None


def _customer_deferred_identity(messages) -> bool:
    """Cliente prefere não informar os fatores agora, sem transformar isso em GAP.

    A resposta não autoriza consulta de conta, mas Suporte ainda pode orientar
    medidas físicas seguras quando o próprio histórico já indica uma falha
    técnica. Mantemos a decisão fora do modelo para não encaminhar um caso
    simples apenas porque os fatores não estão disponíveis naquele momento.
    """
    if not messages or messages[-1].role != "user":
        return False
    value = normalize(messages[-1].content)
    has_deferment = any(
        phrase in value
        for phrase in (
            "nao estou com os dados",
            "nao estou com esses dados",
            "nao tenho os dados",
            "nao tenho esses dados",
            "nao tenho os dados em maos",
            "nao estou com os dados em maos",
            "nao estou com meu cpf",
            "nao tenho meu cpf",
            "nao tenho o cpf",
            "nao estou com essas informacoes",
            "nao tenho essas informacoes",
            "nao consigo informar agora",
            "nao consigo passar agora",
            "nao sei informar",
            "nao sei de cabeca",
            "vou procurar os dados",
            "vou pegar os dados",
            "posso informar mais tarde",
            "prefiro nao informar",
            "prefiro nao enviar",
            "nao quero informar",
            "nao quero enviar",
            "nao vou informar",
            "nao vou enviar",
            "sem passar meus dados",
            "sem informar meus dados",
            "sem enviar meus dados",
            "sem dados de cadastro",
        )
    )
    identity_was_requested = any(
        message.role == "assistant"
        and "cpf" in normalize(message.content)
        for message in messages[:-1]
    )
    return has_deferment and identity_was_requested


def _continued_unverified_support_guidance(messages) -> str | None:
    """Evita que a conversa reabra testes já respondidos após adiar a identidade."""
    if len(messages) < 4 or messages[-1].role != "user":
        return None
    latest = normalize(messages[-1].content)
    had_los_question = any(
        message.role == "assistant" and "luz los" in normalize(message.content)
        for message in messages[:-1]
    )
    no_optical_alarm = any(
        phrase in latest
        for phrase in (
            "nenhuma luz esta vermelha",
            "nenhuma luz vermelha",
            "nao tem luz vermelha",
            "nao ha luz vermelha",
            "as outras parecem normais",
        )
    )
    rebooted = any(
        message.role == "user"
        and any(term in normalize(message.content) for term in ("reinic", "desliguei", "liguei"))
        for message in messages[:-1]
    )
    if had_los_question and no_optical_alarm and rebooted and _has_recent_multi_device_slowness(messages):
        identity_was_requested = any(
            message.role == "assistant"
            and "cpf" in normalize(message.content)
            and "nascimento" in normalize(message.content)
            for message in messages[:-1]
        )
        account_lookup_note = (
            " Sem confirmar o cadastro eu não consigo consultar a conexão, mas, se a luz LOS acender ou o problema piorar, me avise por aqui."
            if identity_was_requested
            else " Se você quiser que eu consulte a situação específica da sua conexão ou algum chamado, eu confirmo o cadastro na hora certa."
        )
        return (
            "Entendi, não precisa mexer nos cabos agora. Como a lentidão continua em mais de um aparelho mesmo depois do reinício, "
            "mantenha o roteador ligado e evite reiniciá-lo de novo por enquanto."
            + account_lookup_note
        )
    return None


def _technical_context_before_identity(messages, previous_intent: str | None) -> bool:
    if previous_intent == "technical_support":
        return True
    return any(
        message.role == "user"
        and any(term in normalize(message.content) for term in ("los", "sem internet", "conexao", "conexão"))
        for message in messages[:-1]
    )


def _handoff_exceeds_question_scope(question: str, reason: str | None) -> bool:
    """Rejeita GAP por um detalhe que o cliente não perguntou."""
    normalized_question = normalize(question)
    normalized_reason = normalize(reason or "")
    schedule_terms = ("prazo", "previsao", "data", "agenda", "presencial")
    return (
        any(term in normalized_reason for term in schedule_terms)
        and not any(term in normalized_question for term in schedule_terms)
    )


def _select_operational_skill(
    skills: list[OperationalSkillIn], route_key: str, question: str = ""
) -> OperationalSkillIn | None:
    """Seleciona setor e gatilho deterministicamente; usa protocolo global como fallback."""
    exact = [skill for skill in skills if skill.route_key == route_key]
    candidates = exact or [skill for skill in skills if skill.route_key is None]
    if not candidates:
        return None
    normalized_question = normalize(question)

    # Suporte começa por diagnóstico seguro. Skills que preparam chamado ou OS
    # só podem assumir quando o cliente pede explicitamente pelo registro já
    # existente; sem esse portão, uma descrição curta de falha poderia selecionar
    # uma skill de ação, perder a orientação inicial e acabar em GAP por baixa
    # confiança mesmo havendo procedimento resolutivo aprovado.
    asks_for_record = any(
        term in normalized_question
        for term in ("chamado", "ordem de servico", "ticket", "protocolo")
    )
    asks_follow_up_without_new_symptom = (
        any(term in normalized_question for term in ("me avise", "me avisar", "me chama", "me chame", "me ligar", "retornar", "retorno", "acompanhar"))
        and not any(term in normalized_question for term in ("sem internet", "lenta", "lento", "los", "oscil", "instavel", "instável"))
    )
    if route_key == "technical_support" and asks_follow_up_without_new_symptom:
        follow_up = next((skill for skill in candidates if skill.key == "support-follow-up-consent"), None)
        if follow_up:
            return follow_up
    if route_key == "technical_support" and not asks_for_record:
        core_diagnosis = next(
            (
                skill for skill in candidates
                if skill.key == "support-core-diagnosis"
                and "guide_safe_troubleshooting" in skill.allowed_actions
                and skill.protocol_steps
            ),
            None,
        )
        if core_diagnosis:
            return core_diagnosis

    # Financeiro e Vendas ainda operam apenas em sombra, mas a seleção precisa
    # ser inequívoca antes do piloto. Os textos dos protocolos são completos e
    # longos; estes sinais curtos evitam empate artificial por palavras como
    # "pedido" ou "cliente" e favorecem a skill de maior risco aplicável.
    route_cues: dict[str, tuple[tuple[tuple[str, ...], str], ...]] = {
        "billing": (
            (("contratos ativos", "contrato ativo", "renovar contrato", "renovacao do contrato", "renovação do contrato"), "billing-contract-summary"),
            (("reembolso", "estorno", "chargeback", "credito", "crédito"), "billing-refund-preparation"),
            (("cancelar", "cancelamento"), "billing-cancellation-effects"),
            (("parcelar", "parcelamento", "renegociar", "renegociacao", "renegociação", "acordo", "juros", "multa", "desconto"), "billing-policy-boundary"),
            (("pagamento", "compensou", "compensacao", "compensação", "comprovante"), "billing-unrecognized-payment"),
            (("fatura", "boleto", "segunda via", "vencimento"), "billing-invoice-copy"),
            (("me avise", "me avisar", "me chama", "me chame", "me ligar", "retornar", "retorno", "acompanhar"), "billing-follow-up-consent"),
        ),
        "sales": (
            (("internet comercial", "internet para empresa", "plano comercial", "plano para empresa"), "sales-business-qualification"),
            (("cancelar", "cancelamento", "desistir"), "sales-retention-cancellation"),
            # A consulta de cobertura precisa vir antes de um pedido acessório
            # de retorno. Primeiro a IA coleta o endereço/viabilidade sem
            # prometer atendimento; só depois poderá tratar o follow-up.
            (("cobertura", "disponibilidade", "atende meu endereco", "atende meu endereço", "viabilidade"), "sales-coverage-intake"),
            (("me ligar", "me chama", "me chame", "retornar", "retorno", "whatsapp", "acompanhar"), "sales-follow-up-consent"),
            # Um pedido genérico de proposta ainda é uma conversa de descoberta:
            # primeiro entendemos perfil e disponibilidade, sem antecipar CPF ou
            # uma proposta formal. A skill formal só entra quando o pedido já
            # deixa claro que essa etapa foi alcançada.
            (("proposta formal", "proposta padrao", "proposta padrão", "proposta fechada", "orcamento fechado", "orçamento fechado"), "sales-standard-proposal"),
            (("proposta", "orcamento", "orçamento"), "sales-plan-qualification"),
            (("plano", "planos"), "sales-plan-qualification"),
        ),
    }
    for terms, preferred_key in route_cues.get(route_key, ()):
        if any(term in normalized_question for term in terms):
            preferred = next((skill for skill in candidates if skill.key == preferred_key), None)
            if preferred:
                return preferred

    def score(skill: OperationalSkillIn) -> tuple[float, int]:
        if not skill.trigger_conditions:
            return (0.1, skill.version)
        best = 0.0
        question_words = set(normalized_question.split())
        for trigger in skill.trigger_conditions:
            normalized_trigger = normalize(trigger)
            if normalized_trigger and normalized_trigger in normalized_question:
                best = max(best, 1.0)
                continue
            trigger_words = set(normalized_trigger.split())
            if trigger_words:
                best = max(best, len(question_words & trigger_words) / len(trigger_words))
        # No suporte, o diagnóstico deve vir antes da preparação de chamado/OS.
        # A skill de ação só ganha prioridade quando o cliente pergunta
        # explicitamente pelo registro operacional.
        actions = set(skill.allowed_actions)
        if "guide_safe_troubleshooting" in actions and not asks_for_record:
            best += 0.25
        if asks_for_record and actions.intersection({"read_ticket", "read_service_order"}):
            best += 0.25
        return (best, skill.version)

    return max(candidates, key=score)


def _skill_prompt(skill: OperationalSkillIn | None) -> str | None:
    if not skill:
        return None
    payload = {
        "key": skill.key,
        "version": skill.version,
        "required_data": skill.required_data,
        "protocol_steps": skill.protocol_steps,
        "allowed_actions": skill.allowed_actions,
        "forbidden_actions": skill.forbidden_actions,
        "completion_criteria": skill.completion_criteria,
        "review_conditions": skill.review_conditions,
        "human_handoff_conditions": skill.human_handoff_conditions,
        "identity_requirement": skill.identity_requirement,
        "minimum_confidence": skill.minimum_confidence,
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _skill_allows_source(
    skill: OperationalSkillIn | None, chunk: retrieval.RetrievedChunk
) -> bool:
    if not skill or not skill.allowed_sources or "*" in skill.allowed_sources:
        return True
    if chunk.source_id in skill.allowed_sources:
        return True
    # A skill usa o nome de capacidade IXC_READ; já a fonte factual carrega
    # sua origem como factualSource=IXC. Trate essa equivalência somente para
    # o marcador explícito, sem liberar outras fontes externas.
    factual_source = str(chunk.source_meta.get("factualSource") or "").upper()
    if "IXC_READ" in skill.allowed_sources and factual_source == "IXC":
        return True
    if "RAG_APPROVED" not in skill.allowed_sources:
        return False
    governance = str(
        chunk.source_meta.get("governance")
        or chunk.source_meta.get("reviewStatus")
        or chunk.source_meta.get("review_status")
        or ""
    ).upper()
    return governance == "APPROVED" or _is_safe_provisional_support_chunk(chunk)


def _approved_chunk_matches_route(chunk: retrieval.RetrievedChunk, route_key: str) -> bool:
    governance = str(chunk.source_meta.get("governance") or "").upper()
    department = str(chunk.source_meta.get("department") or "")
    return (
        (governance == "APPROVED" and department in ("global", route_key))
        or (route_key == "technical_support" and _is_safe_provisional_support_chunk(chunk))
    )


def _is_safe_provisional_support_chunk(chunk: retrieval.RetrievedChunk) -> bool:
    """Uso provis�rio: somente suporte t�cnico do pipeline seguro e revisado semanalmente."""
    governance = str(chunk.source_meta.get("governance") or "").upper()
    return (
        governance == "AUTO_REVIEW_REQUIRED"
        and str(chunk.source_meta.get("department") or "") == "technical_support"
        and chunk.source_meta.get("origin") == "HUMAN_RESOLVED_CASE"
        and chunk.source_meta.get("weeklyReviewRequired") is True
    )


def _approved_chunk_conflicts_with_route(
    chunk: retrieval.RetrievedChunk, route_key: str
) -> bool:
    governance = str(chunk.source_meta.get("governance") or "").upper()
    department = str(chunk.source_meta.get("department") or "")
    return governance == "APPROVED" and department not in ("global", route_key)


def _skill_can_resolve_procedurally(
    skill: OperationalSkillIn | None, triage: TriageResult
) -> bool:
    """Permite orientação segura sem transformar falta de artigo RAG em GAP.

    Só vale para skill ativa enviada pela API, no setor correto e com ação
    explicitamente resolutiva. Não autoriza fatos externos, prazos nem escrita.
    """
    if not skill or skill.route_key != triage.route_key or not skill.protocol_steps:
        return False

    # Suporte pode orientar testes seguros sem depender de um artigo recuperado.
    if "guide_safe_troubleshooting" in skill.allowed_actions:
        return True

    # Em Vendas, a coleta inicial é segura e não contém preço, cobertura
    # garantida, cadastro nem contato externo. Portanto, a ausência momentânea
    # de um trecho RAG não deve transformar uma continuação simples em GAP.
    # Ações comerciais que escrevem ou prometem algo continuam excluídas.
    safe_sales_intake_actions = {
        "qualify_business_need",
        "collect_minimum_coverage_context",
        "prepare_lead_intake",
        "prepare_follow_up_consent",
    }
    return (
        triage.route_key == "sales"
        and bool(safe_sales_intake_actions.intersection(skill.allowed_actions))
        and "execute_external_write" in skill.forbidden_actions
    )


def _verified_invoice_evidence_authorizes_invoice_reply(
    payload: ReplyRequest, skill: OperationalSkillIn | None
) -> bool:
    """Permite a fonte factual IXC sustentar uma segunda via já confirmada.

    O score semântico do RAG ajuda a escolher linguagem e procedimento, mas não
    é mais forte que uma leitura atual, protegida e inequívoca da própria
    fatura. Esta regra é deliberadamente estreita: não vale para pagamento,
    alteração financeira, contrato, ausência de título ou qualquer outro setor.
    """
    if (
        not payload.identity_verified
        or not skill
        or skill.route_key != "billing"
        or skill.key != "billing-invoice-copy"
        or "invoices" not in payload.operational_context.planned_actions
    ):
        return False
    evidence = payload.operational_context.evidence
    if not isinstance(evidence, dict) or evidence.get("source") != "IXC":
        return False
    if evidence.get("status") != "success":
        return False
    facts = evidence.get("facts")
    return isinstance(facts, list) and any(
        isinstance(fact, dict) and fact.get("resource") == "invoices"
        for fact in facts
    )


def _retrieval_limit(question: str, triage: TriageResult, configured: int) -> int:
    """Usa pouco contexto por padrão e amplia apenas em perguntas difíceis."""
    maximum = max(1, configured)
    normalized_length = len(" ".join(question.split()))
    if triage.confidence < 0.55 or normalized_length >= 240:
        desired = 6
    elif normalized_length >= 100:
        desired = 4
    else:
        desired = 3
    return min(maximum, desired)


def _case_summary(messages: list, *, org_id: str | None = None) -> str | None:
    """Resumo extrativo seguro: usa só falas do cliente e nunca inventa fatos."""
    ignored = {"oi", "ola", "olá", "bom dia", "boa tarde", "boa noite", "obrigado", "obrigada"}
    useful: list[str] = []
    for message in reversed(messages):
        if message.role != "user":
            continue
        clean = " ".join(message.content.split()).strip()
        if clean.startswith("[") and clean.endswith("]"):
            continue
        if not clean or clean.casefold().rstrip("!.,?") in ignored or is_social_only_message(clean, org_id=org_id):
            continue
        if clean not in useful:
            useful.append(clean)
        if len(useful) == 3:
            break
    if not useful:
        return None
    text = " · ".join(reversed(useful))
    if len(text) <= 280:
        return text
    shortened = text[:277].rsplit(" ", 1)[0]
    return f"{shortened}..."


def _handoff(
    reason: str,
    confidence: float = HEURISTIC_HANDOFF_CONFIDENCE,
    triage: TriageResult | None = None,
    case_summary: str | None = None,
    selected_skill: OperationalSkillIn | None = None,
) -> ReplyResponse:
    classified = triage or TriageResult("general_support", "unrouted", 0.0)
    return ReplyResponse(
        reply=None,
        handoff=True,
        handoff_reason=reason,
        confidence=confidence,
        # Um GAP é uma decisão governada. Registrar seu motivo torna a decisão
        # auditável no Omni sem fingir que há uma fonte factual para o cliente.
        sources=[f"policy:handoff:{reason}"],
        intent=classified.intent,
        route_key=classified.route_key,
        triage_confidence=classified.confidence,
        secondary_intent=classified.secondary_intent,
        alternative_route_key=classified.alternative_route_key,
        conflict_detected=classified.conflict_detected,
        routing_evidence=list(classified.evidence),
        case_summary=case_summary,
        selected_skill_key=selected_skill.key if selected_skill else None,
        selected_skill_version=selected_skill.version if selected_skill else None,
    )


def _reviewed_gap_continuation(
    triage: TriageResult,
    case_summary: str | None,
    confidence: float,
    selected_skill: OperationalSkillIn | None,
) -> ReplyResponse:
    """Continuação segura quando uma dúvida já recebeu revisão humana.

    Evita reabrir o mesmo GAP se o provedor falhar ou insistir em handoff. O
    texto não incorpora a orientação bruta, portanto não vaza notas internas.
    """
    return ReplyResponse(
        reply=(
            "Já recebi a orientação para este caso e vou seguir com a próxima etapa. "
            "Se eu precisar confirmar mais algum dado com você, te aviso por aqui."
        ),
        handoff=False,
        handoff_reason=None,
        confidence=confidence,
        sources=["internal:reviewed-guidance"],
        intent=triage.intent,
        route_key=triage.route_key,
        triage_confidence=triage.confidence,
        secondary_intent=triage.secondary_intent,
        alternative_route_key=triage.alternative_route_key,
        conflict_detected=triage.conflict_detected,
        routing_evidence=list(triage.evidence),
        case_summary=case_summary,
        clarification=False,
        conversation_level="direto",
        selected_skill_key=selected_skill.key if selected_skill else None,
        selected_skill_version=selected_skill.version if selected_skill else None,
    )


def _latest_customer_turn_text(messages) -> str:
    """Lê o pedido completo quando o cliente envia várias mensagens antes da resposta."""
    last_index = next((index for index in range(len(messages) - 1, -1, -1)
                       if messages[index].role == "user"), None)
    if last_index is None:
        return ""
    if normalize(messages[last_index].content).startswith("[identidade validada"):
        last_index = next((index for index in range(last_index - 1, -1, -1)
                           if messages[index].role == "user"
                           and not normalize(messages[index].content).startswith("[identidade validada")), None)
    if last_index is None:
        return ""
    turn: list[str] = []
    while last_index >= 0 and messages[last_index].role == "user":
        content = messages[last_index].content.strip()
        if content and not normalize(content).startswith("[identidade validada"):
            turn.insert(0, content)
        last_index -= 1
    return "\n".join(turn)


def _pipeline(payload: ReplyRequest) -> ReplyResponse:
    last_user_message = next((message.content for message in reversed(payload.messages)
                              if message.role == "user"), "")
    identity_just_verified = (
        payload.identity_verified and "[Identidade validada com segurança]" in last_user_message
    )
    question = _latest_customer_turn_text(payload.messages)
    if not question:
        return _handoff("mensagem_do_usuario_ausente", confidence=0.0)

    # (a) Heuristica pt-BR PRE-LLM — handoff sem gastar tokens.
    # A necessidade ATUAL define o setor. O histórico segue disponível para a
    # resposta, mas não prende a conversa ao assunto anterior nem cria conflito
    # artificial ao concatenar várias intenções antigas.
    triage = detect_intent(question)
    previous_routes = {
        "technical_support": "technical_support",
        "billing": "billing",
        "sales": "sales",
        "cancellation": "sales",
    }
    previous_intent = payload.operational_context.previous_intent
    # Encerramento natural não é uma nova solicitação financeira, comercial ou
    # técnica. Palavras como "retorno" em um agradecimento não podem deslocar
    # uma conversa já em Suporte para Financeiro antes de a regra de fechamento
    # ser aplicada mais abaixo.
    closing_in_progress = closing_kind(payload.messages)
    # Uma nova intenção específica sempre prevalece. Mas uma continuação curta
    # ("são cinco pessoas", "continua igual") não pode apagar o setor já
    # confirmado só porque não repete as palavras do primeiro pedido.
    previous_route = previous_routes.get(previous_intent)
    new_specific_route = (
        previous_route is not None
        and triage.route_key in set(previous_routes.values())
        and triage.route_key != previous_route
    )
    # O sinal de continuidade vem do planejador de leituras e pode permanecer
    # verdadeiro por causa do histórico. Ele estabiliza respostas curtas ou
    # genéricas, mas jamais pode apagar uma intenção nova e explícita, como
    # alguém que sai de uma dúvida sobre fatura para perguntar pelos planos.
    # Nesta situação o setor atual precisa prevalecer, inclusive para que a
    # skill e as regras de segurança corretas sejam aplicadas.
    preserve_previous_route = (
        previous_route is not None
        and (
            closing_in_progress is not None
            or
            triage.route_key == "unrouted"
            or (
                payload.operational_context.continued_from_previous
                and triage.route_key == previous_route
            )
        )
    )
    if preserve_previous_route:
        triage = TriageResult(
            intent=previous_intent,
            route_key=previous_routes[previous_intent],
            confidence=max(payload.operational_context.triage_confidence or 0.0, 0.85),
            evidence=("continuidade_operacional_validada",),
        )
    selection_context = contextual_search_query(payload.messages, org_id=payload.org_id) or question
    selected_skill = _select_operational_skill(
        payload.operational_skills, triage.route_key, selection_context
    )
    case_summary = _case_summary(payload.messages, org_id=payload.org_id)

    # A entrada de localização já passou pelo adaptador IXC e virou um marcador
    # seguro. Ela precisa ter precedência sobre qualquer resposta genérica do
    # modelo: quando houver candidato, pede apenas os fatores mínimos; quando
    # não houver, oferece CEP+número. Nunca troca isso por diagnóstico técnico
    # antes de concluir a tentativa de identificar o cadastro.
    location_status = _location_identity_status(question)
    if location_status == "candidate_ready":
        return ReplyResponse(
            reply="Recebi a localização. Para localizar o cadastro correto, me envie o CPF completo do titular.",
            handoff=False, handoff_reason=None, confidence=1.0,
            sources=["policy:identity-location-fallback"],
            intent=triage.intent, route_key=triage.route_key,
            triage_confidence=triage.confidence, case_summary=case_summary,
            clarification=True, conversation_level="cauteloso",
        )
    if location_status == "no_candidate":
        return ReplyResponse(
            reply="Não consegui associar essa localização ao cadastro. Me envie o CEP e o número do endereço para eu tentar por essa referência.",
            handoff=False, handoff_reason=None, confidence=0.85,
            sources=["policy:identity-location-fallback"],
            intent=triage.intent, route_key=triage.route_key,
            triage_confidence=triage.confidence, case_summary=case_summary,
            clarification=True, conversation_level="cauteloso",
        )
    if location_status == "unavailable":
        return ReplyResponse(
            reply="Não consegui consultar o cadastro pela localização agora. Me envie o CEP e o número do endereço para eu tentar por essa referência.",
            handoff=False, handoff_reason=None, confidence=0.85,
            sources=["policy:identity-location-fallback"],
            intent=triage.intent, route_key=triage.route_key,
            triage_confidence=triage.confidence, case_summary=case_summary,
            clarification=True, conversation_level="cauteloso",
        )
    settings = get_settings()
    # Compatibilidade entre o piloto original (uma rota) e a configuração
    # atual, que permite uma lista explícita de setores homologados. A decisão
    # continua fechada: Financeiro/Vendas só respondem se constarem nela.
    configured_pilot_routes = getattr(settings, "pilot_route_keys", None)
    if not configured_pilot_routes:
        configured_pilot_routes = (getattr(settings, "pilot_route_key", "technical_support"),)
    elif isinstance(configured_pilot_routes, str):
        configured_pilot_routes = tuple(
            route.strip()
            for route in configured_pilot_routes.split(",")
            if route.strip()
        )
    if (
        triage.route_key in {"billing", "sales"}
        and triage.route_key not in configured_pilot_routes
    ):
        return _handoff(
            "setor_fora_do_piloto",
            confidence=triage.confidence,
            triage=triage,
            case_summary=case_summary,
        )
    heuristic_reason = detect_handoff(question)
    if heuristic_reason:
        return _handoff(heuristic_reason, triage=triage, case_summary=case_summary)
    # Uma recorrência explícita logo após visita técnica não é uma nova triagem
    # comum. O histórico da visita precisa ser confrontado por um responsável;
    # insistir em testes genéricos só atrasa o retorno e pode duplicar uma ação.
    # O GAP mantém a IA no atendimento e carrega o resumo, sem criar OS/visita.
    asks_for_existing_record = any(
        term in normalize(question)
        for term in ("chamado", "ordem de servico", "ticket", "protocolo")
    )
    if (
        triage.route_key == "technical_support"
        and _is_recurrence_after_visit(question)
        and not asks_for_existing_record
    ):
        return _handoff(
            "recorrencia_apos_atendimento_tecnico",
            confidence=triage.confidence,
            triage=triage,
            case_summary=case_summary,
        )

    # A ausência de computador no cabo não é exceção nem exige consulta humana.
    # Com lentidão já confirmada em vários aparelhos, avançamos por uma única
    # pergunta segura em vez de deixar o modelo transformar a limitação em GAP.
    if (
        triage.route_key == "technical_support"
        and _wired_test_is_unavailable(question)
        and _has_recent_multi_device_slowness(payload.messages)
    ):
        if _has_reported_non_optical_indicator(payload.messages):
            guidance = (
                f"Sem problema, dá para seguir sem o teste por cabo. Como você já informou que {_reported_light_status(payload.messages)}, "
                "mantenha o roteador ligado e evite reiniciá-lo de novo por enquanto. "
                "Sem confirmar o cadastro eu não consigo consultar a conexão, mas, se a lentidão piorar ou a luz mudar, me avise por aqui."
            )
        else:
            guidance = (
                "Sem problema, dá para seguir sem o teste por cabo. Como a lentidão aparece em mais de um aparelho, "
                "você percebe se alguma luz do equipamento está vermelha ou piscando diferente agora?"
            )
        return ReplyResponse(
            reply=guidance,
            handoff=False,
            handoff_reason=None,
            confidence=max(triage.confidence, selected_skill.minimum_confidence if selected_skill else 0.85),
            sources=["policy:safe-connectivity-continuation"],
            intent="technical_support",
            route_key="technical_support",
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=True,
            conversation_level="passo_a_passo",
            selected_skill_key=selected_skill.key if selected_skill else None,
            selected_skill_version=selected_skill.version if selected_skill else None,
        )

    # A LOS ter apagado muda o cenário: ela não confirma que a conexão voltou,
    # apenas encerra o alarme óptico anterior. Quando a pessoa relata lentidão
    # em mais de um aparelho na sequência, seguimos com a triagem de lentidão
    # sem repetir a pergunta sobre LOS nem antecipar identidade.
    if (
        triage.route_key == "technical_support"
        and _los_turned_off(question)
        and _current_multi_device_slowness(question)
    ):
        return ReplyResponse(
            reply=response_contract("support.los_to_slowness").text,
            handoff=False,
            handoff_reason=None,
            confidence=max(triage.confidence, selected_skill.minimum_confidence if selected_skill else 0.85),
            sources=["policy:los-to-slowness-continuation"],
            intent="technical_support",
            route_key="technical_support",
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=True,
            conversation_level="passo_a_passo",
            selected_skill_key=selected_skill.key if selected_skill else None,
            selected_skill_version=selected_skill.version if selected_skill else None,
        )

    greeting = greeting_reply(question, payload.conversation_id, org_id=payload.org_id)
    if greeting:
        return ReplyResponse(
            reply=greeting, handoff=False, handoff_reason=None, confidence=1.0,
            sources=["policy:greeting"], intent=triage.intent, route_key=triage.route_key,
            triage_confidence=triage.confidence, case_summary=case_summary,
            clarification=True, conversation_level="acolhedor",
        )

    follow_up_consent = _follow_up_consent_reply(question, selected_skill)
    if follow_up_consent:
        return ReplyResponse(
            reply=follow_up_consent,
            handoff=False,
            handoff_reason=None,
            confidence=max(triage.confidence, selected_skill.minimum_confidence),
            sources=["policy:follow-up-consent", f"skill:{selected_skill.key}@{selected_skill.version}"],
            intent=triage.intent,
            route_key=triage.route_key,
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=True,
            conversation_level="acolhedor",
            selected_skill_key=selected_skill.key,
            selected_skill_version=selected_skill.version,
        )

    sales_next_step = (
        _sales_qualification_next_step(
            payload.messages,
            question,
            selected_skill,
            payload.operational_context.case_state,
        )
        if triage.route_key == "sales" and not payload.operational_context.identity_required_now
        else None
    )
    if sales_next_step:
        first_turn_prefix = (
            f"{first_contact_opening(triage.intent, payload.conversation_id)}\n\n"
            if sum(message.role == "user" for message in payload.messages) == 1
            and not any(message.role == "assistant" for message in payload.messages)
            else ""
        )
        return ReplyResponse(
            reply=first_turn_prefix + sales_next_step,
            handoff=False,
            handoff_reason=None,
            confidence=max(triage.confidence, selected_skill.minimum_confidence if selected_skill else 0.85),
            sources=["policy:sales-qualification-state"],
            intent=triage.intent,
            route_key=triage.route_key,
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=True,
            conversation_level="passo_a_passo",
            selected_skill_key=selected_skill.key if selected_skill else None,
            selected_skill_version=selected_skill.version if selected_skill else None,
        )

    # Encerramento é uma regra de experiência, não uma nova dúvida. Detectar antes
    # do RAG evita GAP falso, chamada desnecessária ao modelo e texto robótico.
    ending = closing_kind(payload.messages)
    if ending:
        return ReplyResponse(
            reply=closing_message(ending, payload.conversation_id),
            handoff=False,
            handoff_reason=None,
            confidence=1.0,
            sources=["policy:closing"],
            intent=triage.intent,
            route_key=triage.route_key,
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=False,
            conversation_level="acolhedor",
        )

    # O estado operacional vem da API e contém somente fatos estruturados já
    # observados neste caso. Ele é a autoridade para a próxima pergunta segura;
    # assim, um pedido antigo de CPF ou uma interpretação livre do modelo não
    # pode substituir a transição atual de sinal para lentidão.
    case_state = payload.operational_context.case_state or {}
    state_next_step = str(case_state.get("nextStep") or "")
    if (
        not payload.identity_verified
        and not payload.operational_context.identity_required_now
        and triage.route_key == "technical_support"
    ):
        state_reply: str | None = None
        if state_next_step == "ASK_LOS_DURATION" and _is_los_signal_issue(question):
            state_reply = (
                "Entendi. Como você já reiniciou o equipamento e a luz LOS continua vermelha, vamos olhar isso por partes. "
                "Ela indica que o sinal óptico não está chegando ao aparelho neste momento. "
                "Você percebeu se ela ficou assim agora ou já estava vermelha há mais tempo?"
            )
        elif state_next_step == "ASK_INTERNET_LIGHT" and _los_turned_off(question):
            state_reply = response_contract("support.los_to_slowness").text
        elif state_next_step == "PROVIDE_STABILIZATION_GUIDANCE" and _reports_internet_light(question):
            state_reply = (
                "Obrigado por confirmar. Com a LOS apagada e a luz de internet piscando, o sinal óptico parece ter voltado; "
                "o que permanece é uma instabilidade na conexão. Como ela aparece nos dois celulares, mantenha o equipamento "
                "ligado e evite reiniciá-lo novamente por enquanto. Se não normalizar, eu sigo com você por aqui."
            )
        elif state_next_step == "ASK_LIGHT_STATE" and _current_multi_device_slowness(question):
            state_reply = (
                "Entendi. Como a lentidão está acontecendo em mais de um aparelho, vamos conferir um ponto de cada vez. "
                "Você percebe alguma luz do equipamento vermelha, piscando diferente ou apagada agora?"
            )
        if state_reply:
            return ReplyResponse(
                reply=state_reply,
                handoff=False,
                handoff_reason=None,
                confidence=max(triage.confidence, selected_skill.minimum_confidence if selected_skill else 0.85),
                sources=["policy:structured-case-state"],
                intent="technical_support",
                route_key="technical_support",
                triage_confidence=triage.confidence,
                secondary_intent=triage.secondary_intent,
                alternative_route_key=triage.alternative_route_key,
                conflict_detected=triage.conflict_detected,
                routing_evidence=list(triage.evidence),
                case_summary=case_summary,
                clarification=True,
                conversation_level="passo_a_passo",
                selected_skill_key=selected_skill.key if selected_skill else None,
                selected_skill_version=selected_skill.version if selected_skill else None,
            )

    # Sem identidade não há consulta de dados da conta. Isso não impede uma
    # orientação geral e segura de Suporte quando o cliente apenas deixou a
    # validação para depois. Não delegamos esse caso simples ao modelo/GAP.
    if (
        not payload.identity_verified
        and _customer_deferred_identity(payload.messages)
        and _technical_context_before_identity(
            payload.messages, payload.operational_context.previous_intent
        )
    ):
        return ReplyResponse(
            reply=_unverified_technical_guidance(payload.messages),
            handoff=False,
            handoff_reason=None,
            confidence=0.85,
            sources=["policy:unverified-technical-guidance"],
            intent="technical_support",
            route_key="technical_support",
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=False,
            conversation_level="cauteloso",
        )

    continued_unverified_guidance = (
        _continued_unverified_support_guidance(payload.messages)
        if not payload.identity_verified
        else None
    )
    if continued_unverified_guidance:
        return ReplyResponse(
            reply=continued_unverified_guidance,
            handoff=False,
            handoff_reason=None,
            confidence=0.85,
            sources=["policy:unverified-technical-guidance"],
            intent="technical_support",
            route_key="technical_support",
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=False,
            conversation_level="cauteloso",
        )

    # Se uma validação anterior falhou temporariamente, a pessoa já tentou
    # autorizar a consulta. Não reabrimos esse pedido nem caímos no RAG por
    # falta de fonte: a conversa pode seguir por uma orientação técnica segura.
    if (
        not payload.identity_verified
        and _has_identity_unavailable_marker(payload.messages)
        and (
            triage.route_key == "technical_support"
            or payload.operational_context.previous_intent == "technical_support"
        )
        and _has_los_signal_issue_in_history(payload.messages)
    ):
        return ReplyResponse(
            reply=(
                "Entendi. A validação não está disponível agora, mas não vou te pedir os dados de novo. "
                "Como a luz LOS continua vermelha, mantenha o equipamento ligado e evite mexer no conector da fibra. "
                "Se ela apagar ou mudar, me avise por aqui para seguirmos o diagnóstico."
            ),
            handoff=False,
            handoff_reason=None,
            confidence=0.85,
            sources=["policy:identity-validation-unavailable"],
            intent="technical_support",
            route_key="technical_support",
            triage_confidence=triage.confidence,
            case_summary=case_summary,
            clarification=False,
            conversation_level="cauteloso",
        )

    # Não peça dados pessoais antes de entender uma solicitação ainda genérica,
    # mesmo que uma camada anterior tenha planejado uma consulta protegida.
    if (
        payload.operational_context.planned_actions
        and not payload.identity_verified
        and triage.route_key == "unrouted"
        and not _looks_like_identity_attempt(payload.messages)
        and "[Validação temporariamente indisponível]" not in question
        and not _has_identity_unavailable_marker(payload.messages)
    ):
        opening = (
            f"{first_contact_opening(triage.intent, payload.conversation_id)}\n\n"
            if not any(message.role == "assistant" for message in payload.messages)
            else ""
        )
        return ReplyResponse(
            reply=opening + clarification_question("general_support", payload.conversation_id, payload.clarification_count),
            handoff=False, handoff_reason=None, confidence=triage.confidence,
            sources=["policy:general-intent-clarification"],
            intent=triage.intent, route_key=triage.route_key,
            triage_confidence=triage.confidence, case_summary=case_summary,
            clarification=True, conversation_level="investigativo",
        )

    if (
        payload.operational_context.planned_actions
        and payload.operational_context.identity_required_now
        and not payload.identity_verified
    ):
        phone_candidate_status = payload.operational_context.identity_phone_candidate_status
        initial_opening = (
            f"{first_contact_opening(triage.intent, payload.conversation_id)}\n\n"
            if not any(message.role == "assistant" for message in payload.messages)
            else ""
        )
        if phone_candidate_status == "no_candidate":
            return ReplyResponse(
                reply=(
                    initial_opening
                    + "Não localizei seu cadastro por este número. Me envie o CPF completo do titular para conferir seu acesso."
                ),
                handoff=False, handoff_reason=None, confidence=0.85,
                sources=["policy:identity-phone-fallback"],
                intent=triage.intent, route_key=triage.route_key,
                triage_confidence=triage.confidence, case_summary=case_summary,
                clarification=True, conversation_level="cauteloso",
            )
        if phone_candidate_status == "unavailable":
            return ReplyResponse(
                reply=(
                    initial_opening
                    + "Não consegui confirmar o cadastro por este número. "
                    "Me envie o CPF completo do titular para conferir seu acesso."
                ),
                handoff=False, handoff_reason=None, confidence=0.85,
                sources=["policy:identity-phone-unavailable"],
                intent=triage.intent, route_key=triage.route_key,
                triage_confidence=triage.confidence, case_summary=case_summary,
                clarification=False, conversation_level="cauteloso",
            )
        if _looks_like_identity_attempt(payload.messages):
            return ReplyResponse(
                reply="Não localizei o cadastro com esse CPF. Confira os números e me envie novamente, por favor.",
                handoff=False, handoff_reason=None, confidence=1.0,
                sources=["policy:identity-validation"],
                intent=triage.intent, route_key=triage.route_key,
                triage_confidence=triage.confidence, case_summary=case_summary,
                clarification=True, conversation_level="cauteloso",
            )
        if "[Validação temporariamente bloqueada]" in question:
            return ReplyResponse(
                reply=(
                    "Por segurança, vou pausar essa confirmação por alguns minutos. "
                    "Enquanto isso, posso continuar com as orientações gerais, sem consultar dados da conta."
                ),
                handoff=False, handoff_reason=None, confidence=1.0,
                sources=["policy:identity-validation-lock"],
                intent=triage.intent, route_key=triage.route_key,
                triage_confidence=triage.confidence, case_summary=case_summary,
                clarification=False, conversation_level="cauteloso",
            )
        if "[Validação temporariamente indisponível]" in question:
            # Uma indisponibilidade pontual do IXC não é, por si só, um GAP.
            # Em suporte conseguimos continuar com orientações gerais sem expor
            # dados da conta; apenas a consulta protegida fica para depois.
            is_technical_support = (
                triage.intent == "technical_support"
                or payload.operational_context.previous_intent == "technical_support"
                or "connections" in payload.operational_context.planned_actions
            )
            reply = (
                _unverified_technical_guidance(payload.messages, identity_unavailable=True)
                if is_technical_support
                else "Não consegui confirmar seu cadastro agora. Sem essa confirmação, não vou consultar informações da conta, "
                "mas você pode tentar novamente daqui a pouco com o CPF completo do titular."
            )
            return ReplyResponse(
                reply=reply,
                handoff=False, handoff_reason=None, confidence=0.85,
                sources=["policy:identity-validation-unavailable"],
                intent="technical_support" if is_technical_support else triage.intent,
                route_key="technical_support" if is_technical_support else triage.route_key,
                triage_confidence=triage.confidence, case_summary=case_summary,
                clarification=False, conversation_level="cauteloso",
            )
        if "[Resposta de validação em formato inválido]" in question:
            return ReplyResponse(
                reply="Não consegui ler o CPF. Envie os 11 números do documento, por favor.",
                handoff=False, handoff_reason=None, confidence=1.0,
                sources=["policy:identity-validation-format"],
                intent=triage.intent, route_key=triage.route_key,
                triage_confidence=triage.confidence, case_summary=case_summary,
                clarification=True, conversation_level="cauteloso",
            )
        if "[Identidade não confirmada]" in question:
            return ReplyResponse(
                reply="Não localizei o cadastro com esse CPF. Confira os números e me envie novamente, por favor.",
                handoff=False, handoff_reason=None, confidence=1.0,
                sources=["policy:identity-validation"],
                intent=triage.intent, route_key=triage.route_key,
                triage_confidence=triage.confidence, case_summary=case_summary,
                clarification=True, conversation_level="cauteloso",
            )
        is_technical_support = (
            triage.intent == "technical_support"
            or payload.operational_context.previous_intent == "technical_support"
            or "connections" in payload.operational_context.planned_actions
        )
        if is_technical_support and _has_identity_unavailable_marker(payload.messages):
            if _customer_confirmed_optical_alarm(payload.messages):
                return ReplyResponse(
                    reply=(
                        "A luz LOS/PON vermelha indica perda de sinal. Deixe o equipamento ligado "
                        "e evite mexer no cabo de fibra. Se ela mudar, me avise por aqui."
                    ),
                    handoff=False, handoff_reason=None, confidence=0.85,
                    sources=["policy:identity-validation-unavailable"],
                    intent="technical_support", route_key="technical_support",
                    triage_confidence=triage.confidence, case_summary=case_summary,
                    clarification=False, conversation_level="cauteloso",
                )
            reply = (
                "Entendi. Como a luz LOS continua vermelha mesmo depois de reiniciar, "
                "isso indica que o sinal da fibra não está chegando ao equipamento. "
                "Não vou te pedir os dados de novo agora. Deixe o equipamento ligado e evite mexer no conector da fibra."
                if _has_los_signal_issue_in_history(payload.messages)
                else "Entendi. Não vou te pedir os dados de novo agora. Sem confirmar o cadastro, não consigo consultar a conta, "
                "mas consigo continuar pela orientação geral: você consegue observar se alguma luz no equipamento está vermelha, piscando ou apagada?"
            )
            return ReplyResponse(
                reply=reply,
                handoff=False, handoff_reason=None, confidence=0.85,
                sources=["policy:identity-validation-unavailable"],
                intent="technical_support", route_key="technical_support",
                triage_confidence=triage.confidence, case_summary=case_summary,
                clarification=False, conversation_level="cauteloso",
            )
        identity_intro = (
            "Sei que é chato passar por isso de novo. "
            if conversation_level(question) == "acolhedor"
            else ""
        )
        # A saudação pode chegar antes do relato. Sem resposta anterior da IA,
        # ainda é a primeira abordagem e ela precisa acolher a necessidade.
        is_initial_customer_exchange = not any(
            message.role == "assistant" for message in payload.messages
        )
        support_acknowledgement = (
            _initial_support_acknowledgement(question)
            if is_initial_customer_exchange and triage.route_key == "technical_support"
            else ""
        )
        welcome_intro = (
            f"{first_contact_opening(triage.intent, payload.conversation_id)}\n\n"
            if is_initial_customer_exchange else ""
        )
        identity_scope = "Antes de consultar sua conexão"
        if triage.route_key == "billing":
            identity_scope = "Para consultar as informações financeiras da sua conta"
            if selected_skill and selected_skill.key == "billing-invoice-copy":
                identity_scope = "Para consultar a situação da sua fatura"
            elif selected_skill and selected_skill.key == "billing-unrecognized-payment":
                identity_scope = "Para consultar a situação do seu pagamento"
            elif selected_skill and selected_skill.key == "billing-contract-summary":
                identity_scope = "Para consultar as informações do seu contrato"
        elif triage.route_key == "sales":
            identity_scope = "Para consultar as informações específicas do seu cadastro"
        return ReplyResponse(
            reply=(welcome_intro + support_acknowledgement + identity_intro +
                identity_scope + ", preciso localizar o cadastro correto. "
                "Pode me enviar o CPF completo do titular?"
            ),
            handoff=False,
            handoff_reason=None,
            confidence=1.0,
            sources=["policy:identity-verification"],
            intent=triage.intent,
            route_key=triage.route_key,
            triage_confidence=triage.confidence,
            case_summary=case_summary,
            clarification=True,
            conversation_level="cauteloso",
        )

    evidence = payload.operational_context.evidence
    # Indisponibilidade de fonte é um incidente técnico, não ausência de
    # conhecimento. Em Suporte, ela bloqueia afirmações sobre a conta e qualquer
    # automação sensível, mas não impede a orientação segura baseada em RAG e
    # skill. Outros setores continuam fechados até a fonte voltar.
    operational_source_unavailable = False
    if payload.operational_context.planned_actions and payload.identity_verified:
        if not evidence or evidence.get("status") == "unavailable":
            if triage.route_key != "technical_support":
                return _handoff("fonte_operacional_indisponivel", confidence=0.0, triage=triage, case_summary=case_summary)
            operational_source_unavailable = True
            evidence = None
        if evidence and evidence.get("status") == "customer_ambiguous":
            return _handoff("cliente_ambiguo_no_ixc", confidence=0.0, triage=triage, case_summary=case_summary)
        if evidence and evidence.get("status") == "customer_not_found":
            return _handoff("cliente_nao_localizado_no_ixc", confidence=0.0, triage=triage, case_summary=case_summary)

    evidence_blocks = [
        json.dumps(fact, ensure_ascii=False, sort_keys=True)
        for fact in ((evidence or {}).get("facts") or [])
        if isinstance(fact, dict)
    ]
    network_context = payload.operational_context.network_context
    structural_incident = payload.operational_context.structural_incident
    regional_incident = payload.operational_context.regional_incident
    network_context_inconclusive = False
    if network_context and network_context.get("status") == "INCONCLUSIVE":
        if triage.route_key != "technical_support":
            return _handoff("contexto_tecnico_inconclusivo", confidence=0.0, triage=triage, case_summary=case_summary)
        network_context_inconclusive = True
        network_context = None
    if network_context and network_context.get("status") == "RESOLVED":
        # Entra no mesmo envelope não confiável das demais evidências. O modelo
        # recebe fatos, nunca autoridade para alterar IXC ou Olho de Deus.
        evidence_blocks.append(
            json.dumps(
                {"source": "OLHO_DE_DEUS_OLT", "network_context": network_context.get("context")},
                ensure_ascii=False,
                sort_keys=True,
            )
        )
    if isinstance(structural_incident, dict) and structural_incident.get("status") == "CONFIRMED":
        evidence_blocks.append(
            json.dumps(
                {"source": "IXC_STRUCTURAL_OS", "event": "CUSTOMER_LOGIN_EXPLICITLY_AFFECTED"},
                ensure_ascii=False,
                sort_keys=True,
            )
        )
    if (
        triage.route_key == "technical_support"
        and isinstance(regional_incident, dict)
        and regional_incident.get("status") == "REGISTERED"
    ):
        first_turn_prefix = (
            f"{first_contact_opening(triage.intent, payload.conversation_id)}\n\n"
            if sum(message.role == "user" for message in payload.messages) == 1
            and not any(message.role == "assistant" for message in payload.messages)
            else ""
        )
        return ReplyResponse(
            reply=first_turn_prefix + response_contract("support.regional_outage_confirmed").text,
            handoff=False,
            handoff_reason=None,
            confidence=max(triage.confidence, selected_skill.minimum_confidence if selected_skill else 0.97),
            sources=["policy:regional-outage-confirmed"],
            intent="technical_support",
            route_key="technical_support",
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=False,
            conversation_level="acolhedor",
            selected_skill_key=selected_skill.key if selected_skill else None,
            selected_skill_version=selected_skill.version if selected_skill else None,
        )
    support_outage_step = _support_outage_step(payload, triage, question, case_summary)
    if support_outage_step is not None:
        return support_outage_step
    # A luz LOS é um sintoma claro, mas não define a causa nem transforma a
    # pergunta ao cliente em consulta de incidente coletivo. Se a correlação
    # externa ainda não estiver disponível, avançamos com uma única pergunta
    # segura sobre o sintoma; com contexto RESOLVED, o modelo recebe a evidência.
    if (
        triage.route_key == "technical_support"
        and _is_los_signal_issue(question)
        and (
            not payload.identity_verified
            or (selected_skill is not None and selected_skill.key == "support-core-diagnosis")
        )
        and not (network_context and network_context.get("status") == "RESOLVED")
    ):
        opening = _initial_support_acknowledgement(question)
        return ReplyResponse(
            reply=(
                ("Pronto, confirmei seu cadastro. " if identity_just_verified else "")
                + (opening if opening else "Entendi. ")
                + "Como você já reiniciou o equipamento e a luz LOS continua vermelha, vamos olhar isso por partes. "
                "Ela indica que o sinal óptico não está chegando ao aparelho neste momento. "
                "Você percebeu se ela ficou assim agora ou já estava vermelha há mais tempo?"
            ),
            handoff=False,
            handoff_reason=None,
            confidence=max(triage.confidence, selected_skill.minimum_confidence if selected_skill else 0.0),
            sources=[f"skill:{selected_skill.key}@{selected_skill.version}"] if selected_skill else [],
            intent=triage.intent,
            route_key=triage.route_key,
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=False,
            conversation_level="passo_a_passo",
            selected_skill_key=selected_skill.key if selected_skill else None,
            selected_skill_version=selected_skill.version if selected_skill else None,
        )
    gap_resolution = payload.operational_context.gap_resolution
    if gap_resolution and gap_resolution.get("guidance"):
        evidence_blocks.append(
            json.dumps(
                {
                    "source": "RESPONSAVEL_INTERNO_REVISADO",
                    "guidance": gap_resolution["guidance"],
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )

    should_clarify = needs_clarification(question, triage)
    if should_clarify and payload.clarification_count < MAX_CLARIFICATIONS:
        first_turn_prefix = (
            f"{first_contact_opening(triage.intent, payload.conversation_id)}\n\n"
            if sum(message.role == "user" for message in payload.messages) == 1
            and not any(message.role == "assistant" for message in payload.messages)
            else ""
        )
        return ReplyResponse(
            reply=first_turn_prefix + clarification_question(
                triage.intent,
                payload.conversation_id,
                payload.clarification_count,
                triage.secondary_intent,
            ),
            handoff=False,
            handoff_reason=None,
            confidence=triage.confidence,
            sources=["policy:clarification"],
            intent=triage.intent,
            route_key=triage.route_key,
            triage_confidence=triage.confidence,
            secondary_intent=triage.secondary_intent,
            alternative_route_key=triage.alternative_route_key,
            conflict_detected=triage.conflict_detected,
            routing_evidence=list(triage.evidence),
            case_summary=case_summary,
            clarification=True,
            conversation_level=conversation_level(question, clarifying=True),
        )

    # (b) Busca semantica interna (mesma logica do POST /query).
    # Em uma troca explícita de setor, o histórico continua disponível no
    # resumo do caso, mas não pode diluir a recuperação factual da nova
    # pergunta. Ex.: uma dúvida de fatura seguida por “quais planos existem?”
    # deve recuperar primeiro o catálogo comercial, não um texto financeiro.
    search_query = semantic_search_text(
        question if new_specific_route else (contextual_search_query(payload.messages, org_id=payload.org_id) or question)
    )
    retrieval_limit = _retrieval_limit(question, triage, settings.retrieval_top_k)
    chunks = []
    # O filtro antecipado deixa ``global`` e o setor em rota disponíveis, mas
    # impede que Financeiro, Vendas e Suporte concorram pela mesma janela de
    # recuperação. A checagem abaixo continua como defesa em profundidade.
    for chunk in retrieval.search(
        payload.org_id,
        search_query,
        top_k=retrieval_limit,
        allowed_departments=("global", triage.route_key),
    ):
        if _approved_chunk_conflicts_with_route(chunk, triage.route_key):
            continue
        governed_for_route = _approved_chunk_matches_route(chunk, triage.route_key)
        retrieval_floor = min(settings.retrieval_min_score, 0.25) if governed_for_route else settings.retrieval_min_score
        if chunk.score >= retrieval_floor and _skill_allows_source(selected_skill, chunk):
            chunks.append(chunk)
    if conflicting_authoritative_facts(search_query, chunks):
        return _handoff(
            "conflito_entre_fontes_aprovadas",
            confidence=0.0,
            triage=triage,
            case_summary=case_summary,
        )
    procedural_skill_context = _skill_can_resolve_procedurally(selected_skill, triage)
    verified_invoice_evidence = _verified_invoice_evidence_authorizes_invoice_reply(
        payload, selected_skill
    )
    # Política financeira geral é uma continuação pública: não consulta conta,
    # não negocia condições e não escreve fora do Omni. Ela pode permanecer
    # útil mesmo se a busca semântica não recuperar um trecho específico após
    # uma troca explícita de setor.
    approved_general_financial_policy = bool(
        selected_skill
        and triage.route_key == "billing"
        and selected_skill.key == "billing-policy-boundary"
        and "explain_approved_financial_policy" in selected_skill.allowed_actions
        and not payload.operational_context.identity_required_now
        and "negotiate_terms" in selected_skill.forbidden_actions
        and "execute_external_write" in selected_skill.forbidden_actions
    )
    if not chunks and not evidence_blocks and not procedural_skill_context:
        if approved_general_financial_policy and selected_skill:
            return _safe_public_information_continuation(
                triage=triage,
                selected_skill=selected_skill,
                approved_general_financial_policy=True,
                best_context_score=0.60,
                case_summary=case_summary,
            )
        return _handoff("sem_contexto_na_base_de_conhecimento", confidence=0.0, triage=triage, case_summary=case_summary)

    confidence_evidence = [chunk.score for chunk in chunks]
    if procedural_skill_context and selected_skill:
        confidence_evidence.append(selected_skill.minimum_confidence)
    # Segunda via é uma consulta protegida e factual. Quando o IXC acabou de
    # devolver uma fatura para o cadastro validado, essa evidência é suficiente
    # para atravessar o portão de confiança da skill; o RAG ainda permanece no
    # contexto para orientar linguagem, mas não pode substituir o IXC.
    if verified_invoice_evidence and selected_skill:
        confidence_evidence.append(selected_skill.minimum_confidence)
    best_context_score = clamp01(max(confidence_evidence, default=1.0))
    # Política financeira geral não consulta conta, não negocia e não altera
    # cobrança. Quando há RAG aprovado do próprio setor, ela pode responder
    # com um limiar de evidência menor que o de uma decisão individual (I2),
    # mantendo as condições específicas sempre bloqueadas pela skill.
    # Consulta pública de catálogo segue o mesmo princípio: um snapshot IXC
    # aprovado pode orientar o próximo passo comercial sem validar conta, sem
    # prometer cobertura e sem criar proposta. O piso menor vale somente para
    # a skill de qualificação e apenas quando há fonte factual governada.
    approved_general_sales_catalog = bool(
        selected_skill
        and triage.route_key == "sales"
        and selected_skill.key == "sales-plan-qualification"
        and "read_published_plan" in selected_skill.allowed_actions
        and not payload.operational_context.identity_required_now
        and any(
            str(chunk.source_meta.get("governance") or "").upper() == "APPROVED"
            and str(chunk.source_meta.get("department") or "") == "sales"
            for chunk in chunks
        )
        and "guarantee_coverage" in selected_skill.forbidden_actions
        and bool(
            {"invent_price", "quote_unapproved_price"}.intersection(
                selected_skill.forbidden_actions
            )
        )
    )
    skill_confidence_floor = selected_skill.minimum_confidence if selected_skill else 0
    # Perguntas públicas e não transacionais têm um limite próprio: 0,60 só
    # é permitido quando a fonte é aprovada, pertence ao setor e a skill veda
    # negociação, escrita, preço individual ou promessa de cobertura. Assim,
    # uma formulação curta como “como funciona o parcelamento?” não vira
    # encaminhamento, mas qualquer consulta de conta continua no limite I2.
    if approved_general_financial_policy or approved_general_sales_catalog:
        minimum_confidence = 0.60
    else:
        minimum_confidence = max(
            _MIN_AUTONOMOUS_ANSWER_CONFIDENCE,
            skill_confidence_floor,
        )
    if best_context_score < minimum_confidence:
        if approved_general_financial_policy and selected_skill:
            return _safe_public_information_continuation(
                triage=triage,
                selected_skill=selected_skill,
                approved_general_financial_policy=True,
                best_context_score=best_context_score,
                case_summary=case_summary,
            )
        return _handoff(
            "baixa_confianca_para_resposta_automatica",
            confidence=best_context_score,
            triage=triage,
            case_summary=case_summary,
            selected_skill=selected_skill,
        )

    complete_history: list[ChatMessage] = []
    for message in payload.messages:
        if message.role not in ("user", "assistant"):
            continue
        content = message.content
        if payload.identity_verified:
            if message.role == "user" and content.startswith("[") and content.endswith("]"):
                continue
            if (
                message.role == "assistant"
                and not (payload.operational_context.gap_resolution or {}).get("guidance")
                and _stale_identity_assistant_turn(content)
                and (
                    payload.identity_verified
                    or not payload.operational_context.identity_required_now
                )
            ):
                continue
        if message.role == "user" and "[Identidade validada com segurança]" in content:
            # O marcador técnico não é uma nova intenção do cliente. Para o modelo,
            # retomamos a solicitação que originou a consulta; a confirmação de
            # identidade já viaja em campo estruturado e não precisa ser narrada.
            content = question
        complete_history.append({"role": message.role, "content": content})
    history_context = prepare_history_context(settings, complete_history)
    history = list(history_context.messages)
    auxiliary_state = history_context.auxiliary_state

    # O job de continuação é disparado por uma mensagem SYSTEM interna, que não
    # integra o histórico do cliente. Assim, o histórico pode terminar em
    # `assistant`; a Anthropic rejeita esse formato como prefill. Este marcador
    # existe somente no payload do modelo e nunca é persistido ou exibido.
    if gap_resolution and gap_resolution.get("guidance") and (
        not history or history[-1]["role"] != "user"
    ):
        history.append(
            {
                "role": "user",
                "content": "[Continue o atendimento com a orientação interna revisada.]",
            }
        )

    # (c) System prompt com guardrails + contexto + memória de longo prazo
    # do contato (CONTRACTS §15) — bloco distinto, rotulado como referência.
    contact_name = payload.contact.name if payload.contact else None
    memory_summary = payload.contact.memory_summary if payload.contact else None
    system = build_system_prompt(
        chunks=[chunk.content for chunk in chunks],
        contact_name=contact_name,
        memory_summary=memory_summary,
        conversation_level=conversation_level(question),
        operational_evidence=evidence_blocks,
        operational_skill=_skill_prompt(selected_skill),
        global_directives=[
            json.dumps(
                {
                    "key": directive.key,
                    "title": directive.title,
                    "category": directive.category,
                    "version": directive.version,
                    "principles": directive.principles,
                    "prohibitions": directive.prohibitions,
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            for directive in sorted(payload.global_directives, key=lambda item: item.priority)
        ],
        auxiliary_state=auxiliary_state,
        reviewed_guidance=(gap_resolution or {}).get("guidance"),
        identity_verified=payload.identity_verified,
    )
    if not payload.identity_verified and not payload.operational_context.identity_required_now:
        system += (
            "\n\nESTADO DE PERMISSÃO DESTE TURNO: a pessoa NÃO pediu consulta individual da conta. "
            "Não solicite CPF, mês de nascimento, telefone, identidade nem cadastro. "
            "Siga apenas o próximo passo técnico seguro, sem inventar fatos."
        )
    if operational_source_unavailable:
        system += (
            "\n\nFONTE OPERACIONAL INDISPONÍVEL: não afirme dados do contrato, chamados, OS, "
            "agendamento ou causa individual. Continue somente com orientação técnica segura já aprovada."
        )
    if network_context_inconclusive:
        system += (
            "\n\nCONTEXTO DE REDE INCONCLUSIVO: não afirme ocorrência coletiva, região afetada ou prazo. "
            "Continue apenas com diagnóstico individual seguro e conhecimento aprovado."
        )
    if evidence_blocks and any(
        term in normalize(question) for term in ("chamado", "ordem de servico", " os ")
    ):
        system += (
            "\n\nESCOPO DESTA RESPOSTA: responda somente se há chamado ou ordem de serviço e informe "
            "o status que estiver nas evidências. A ausência de data, previsão ou agendamento não impede "
            "essa resposta e não justifica encaminhamento, pois o cliente não perguntou esses detalhes."
        )

    # (d) LLM com timeout rigido de 30s.
    provider = get_chat_provider()
    try:
        raw_reply = generate_with_timeout(
            provider, history, system, timeout=get_settings().llm_timeout_seconds
        )
    except Exception as primary_error:
        if isinstance(primary_error, TimeoutError):
            logger.warning("LLM timeout: conversation=%s", payload.conversation_id)
        else:
            logger.exception("LLM falhou: conversation=%s", payload.conversation_id)
        if settings.ai_fallback_provider and settings.ai_fallback_provider != (settings.ai_primary_provider or settings.ai_provider):
            try:
                raw_reply = generate_with_timeout(
                    get_chat_provider(settings, role="fallback"),
                    history,
                    system,
                    timeout=settings.llm_timeout_seconds,
                )
            except Exception:
                logger.exception("LLM fallback falhou: conversation=%s", payload.conversation_id)
                if gap_resolution and gap_resolution.get("guidance"):
                    return _reviewed_gap_continuation(
                        triage, case_summary, max(best_context_score, minimum_confidence), selected_skill
                    )
                return _handoff("falha_nos_provedores_llm", confidence=0.0, triage=triage, case_summary=case_summary)
        else:
            if gap_resolution and gap_resolution.get("guidance"):
                return _reviewed_gap_continuation(
                    triage, case_summary, max(best_context_score, minimum_confidence), selected_skill
                )
            reason = "tempo_limite_do_llm_excedido" if isinstance(primary_error, TimeoutError) else "falha_no_provedor_llm"
            return _handoff(reason, confidence=0.0, triage=triage, case_summary=case_summary)

    # (e) Parse do token [HANDOFF] / resposta vazia.
    is_handoff, reply_text, handoff_reason = parse_llm_reply(raw_reply)
    needs_corrective_retry = payload.identity_verified and (
        _contradicts_verified_identity(handoff_reason)
        or _handoff_exceeds_question_scope(question, handoff_reason)
    )
    needs_safe_support_retry = is_handoff and _safe_support_handoff_can_retry(
        triage, selected_skill, handoff_reason
    )
    needs_safe_public_information_retry = is_handoff and _safe_public_information_handoff_can_retry(
        selected_skill=selected_skill,
        approved_general_financial_policy=approved_general_financial_policy,
        approved_general_sales_catalog=approved_general_sales_catalog,
        handoff_reason=handoff_reason,
    )
    if is_handoff and (
        needs_corrective_retry
        or needs_safe_support_retry
        or needs_safe_public_information_retry
    ):
        if needs_corrective_retry:
            corrective_instruction = (
                "CORREÇÃO OBRIGATÓRIA: a identidade está confirmada pelo sistema. "
                "Não peça validação e responda estritamente ao que o cliente perguntou usando as evidências. "
                "Não exija data, previsão, agendamento ou visita quando isso não tiver sido solicitado."
            )
        elif needs_safe_public_information_retry:
            corrective_instruction = (
                "CORREÇÃO OBRIGATÓRIA: há uma fonte aprovada e uma skill ativa que autorizam "
                "esta informação pública. Responda à pergunta usando somente esse contexto. "
                "Não consulte dados de conta, não negocie condições, não prometa cobertura e não "
                "encaminhe para uma pessoa sem um risco concreto."
            )
        else:
            corrective_instruction = (
                "CORREÇÃO OBRIGATÓRIA: a skill de diagnóstico de Suporte permite uma orientação inicial segura. "
                "Não abra HANDOFF por uma limitação comum do diagnóstico (por exemplo, ausência de teste por cabo). "
                "Dê um único próximo passo ou pergunta técnica segura, sem inventar causa, prazo, visita ou dado de conta."
            )
        corrective_system = (
            system
            + "\n\n"
            + corrective_instruction
        )
        try:
            corrective_provider = get_chat_provider(role="auxiliary")
            corrected_raw = generate_with_timeout(
                corrective_provider,
                history,
                corrective_system,
                timeout=get_settings().llm_timeout_seconds,
            )
            is_handoff, reply_text, handoff_reason = parse_llm_reply(corrected_raw)
        except Exception:
            logger.exception(
                "Correção de contradição de identidade falhou: conversation=%s",
                payload.conversation_id,
            )
    if is_handoff and needs_safe_public_information_retry and selected_skill:
        return _safe_public_information_continuation(
            triage=triage,
            selected_skill=selected_skill,
            approved_general_financial_policy=approved_general_financial_policy,
            best_context_score=best_context_score,
            case_summary=case_summary,
        )
    if is_handoff:
        if gap_resolution and gap_resolution.get("guidance"):
            return _reviewed_gap_continuation(
                triage, case_summary, max(best_context_score, minimum_confidence), selected_skill
            )
        return _handoff(
            handoff_reason or "contexto_insuficiente",
            confidence=_LLM_HANDOFF_CONFIDENCE,
            triage=triage,
            case_summary=case_summary,
        )

    reply_text = _polish_customer_reply(reply_text or "")

    # A autorização de consulta é decidida pela API, não pelo modelo. Mesmo se
    # uma resposta do modelo ignorar o prompt, ela não pode induzir o envio de
    # CPF ou data de nascimento durante um diagnóstico ainda público.
    if (
        not payload.identity_verified
        and not payload.operational_context.identity_required_now
        and _requests_identity_from_customer(reply_text)
    ):
        if approved_general_financial_policy and selected_skill:
            return _safe_public_information_continuation(
                triage=triage,
                selected_skill=selected_skill,
                approved_general_financial_policy=True,
                best_context_score=best_context_score,
                case_summary=case_summary,
            )
        if approved_general_sales_catalog and selected_skill:
            return _safe_public_information_continuation(
                triage=triage,
                selected_skill=selected_skill,
                approved_general_financial_policy=False,
                best_context_score=best_context_score,
                case_summary=case_summary,
            )
        if triage.route_key != "technical_support":
            return ReplyResponse(
                reply=(
                    "Antes de consultar informações específicas do seu cadastro, "
                    "posso continuar com as orientações gerais disponíveis por aqui."
                ),
                handoff=False,
                handoff_reason=None,
                confidence=0.85,
                sources=["policy:identity-scope-guard"],
                intent=triage.intent,
                route_key=triage.route_key,
                triage_confidence=triage.confidence,
                case_summary=case_summary,
                clarification=False,
                conversation_level="direto",
                selected_skill_key=selected_skill.key if selected_skill else None,
                selected_skill_version=selected_skill.version if selected_skill else None,
            )
        return ReplyResponse(
            reply=response_contract("guard.identity_scope_technical").text,
            handoff=False,
            handoff_reason=None,
            confidence=0.85,
            sources=["policy:identity-scope-guard"],
            intent="technical_support" if triage.route_key == "technical_support" else triage.intent,
            route_key="technical_support" if triage.route_key == "technical_support" else triage.route_key,
            triage_confidence=triage.confidence,
            case_summary=case_summary,
            clarification=True,
            conversation_level="passo_a_passo",
            selected_skill_key=selected_skill.key if selected_skill else None,
            selected_skill_version=selected_skill.version if selected_skill else None,
        )

    output_block_reason = inspect_reply(
        reply_text or "",
        identity_verified=payload.identity_verified,
        commercial_reviewed=bool(
            gap_resolution
            and gap_resolution.get("reason") == "commercial_approval_required"
            and gap_resolution.get("guidance")
        ),
    )
    if output_block_reason:
        return _handoff(
            output_block_reason,
            confidence=0.0,
            triage=triage,
            case_summary=case_summary,
        )

    if identity_just_verified and reply_text:
        reply_text = f"Pronto, confirmei seu cadastro. {reply_text}"

    if settings.ai_review_provider and needs_model_review(triage, best_context_score, minimum_confidence):
        try:
            approved = approve_reply(
                get_chat_provider(settings, role="review"),
                question=question,
                proposed_reply=reply_text or "",
                trusted_context=system,
                timeout=settings.llm_timeout_seconds,
            )
        except Exception:
            logger.exception("Revisor LLM falhou: conversation=%s", payload.conversation_id)
            return _handoff("falha_na_revisao_da_resposta", confidence=0.0, triage=triage, case_summary=case_summary)
        if not approved:
            return _handoff("resposta_reprovada_pelo_revisor", confidence=0.0, triage=triage, case_summary=case_summary)

    sources: list[str] = []
    for chunk in chunks:
        if chunk.source_id not in sources:
            sources.append(chunk.source_id)
    if procedural_skill_context and selected_skill:
        sources.append(f"skill:{selected_skill.key}@{selected_skill.version}")
    if evidence_blocks:
        sources.append("ixc:operational")

    return ReplyResponse(
        reply=reply_text,
        handoff=False,
        handoff_reason=None,
        confidence=best_context_score,
        sources=sources,
        intent=triage.intent,
        route_key=triage.route_key,
        triage_confidence=triage.confidence,
        secondary_intent=triage.secondary_intent,
        alternative_route_key=triage.alternative_route_key,
        conflict_detected=triage.conflict_detected,
        routing_evidence=list(triage.evidence),
        case_summary=case_summary,
        clarification=False,
        conversation_level=conversation_level(question),
        selected_skill_key=selected_skill.key if selected_skill else None,
        selected_skill_version=selected_skill.version if selected_skill else None,
    )


@router.post("/reply", response_model=ReplyResponse)
def create_reply(payload: ReplyRequest) -> ReplyResponse:
    with usage_scope(payload.org_id, "reply"):
        try:
            return _pipeline(payload)
        except Exception:  # noqa: BLE001 — fail-safe: nunca propagar erro
            logger.exception("pipeline /reply falhou: conversation=%s", payload.conversation_id)
            return _handoff("erro_interno_no_servico_de_ia", confidence=0.0)


@router.post("/triage/analyze", response_model=TriageAnalyzeResponse)
def analyze_triage(payload: TriageAnalyzeRequest) -> TriageAnalyzeResponse:
    user_text = " ".join(message.content for message in payload.messages if message.role == "user")
    triage = detect_intent(user_text)
    return TriageAnalyzeResponse(
        intent=triage.intent,
        route_key=triage.route_key,
        triage_confidence=triage.confidence,
        case_summary=_case_summary(payload.messages, org_id=payload.org_id),
        secondary_intent=triage.secondary_intent,
        alternative_route_key=triage.alternative_route_key,
        conflict_detected=triage.conflict_detected,
        routing_evidence=list(triage.evidence),
    )
