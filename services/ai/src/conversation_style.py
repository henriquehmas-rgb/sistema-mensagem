"""Nível de conversa e clarificação controlada em pt-BR."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from .textutils import normalize
from .triage import TriageResult

MAX_CLARIFICATIONS = 2

# Saudações são úteis na conversa, mas não carregam assunto para a recuperação
# semântica. Quando vêm antes de uma pergunta curta, derrubam a similaridade do
# RAG e podem transformar uma resposta coberta em falso encaminhamento.
_LEADING_GREETING = re.compile(
    r"^(?:oi|ol[aá]|bom\s+dia|boa\s+tarde|boa\s+noite)\s*[!,.;:\-]*\s*",
    flags=re.IGNORECASE,
)
_LEADING_CONVERSATIONAL_FILLER = re.compile(
    r"^(?:(?:tamb[eé]m|ent[aã]o|certo|ok|na\s+verdade)\s*[!,.;:\-]*\s*)*"
    r"(?:(?:eu\s+)?(?:quero|queria)\s+(?:saber|entender)\s+)?",
    flags=re.IGNORECASE,
)


def semantic_search_text(text: str) -> str:
    """Remove aberturas sociais sem modificar o texto exibido ao cliente."""
    clean = _LEADING_GREETING.sub("", " ".join(text.split()).strip())
    clean = _LEADING_CONVERSATIONAL_FILLER.sub("", clean).strip()
    return clean or text

_FIRST_CONTACT_OPENINGS: dict[str, tuple[str, ...]] = {
    # A abertura é igual nos três setores. O contexto e a solicitação vêm na
    # mensagem seguinte, sem transformar a saudação em texto explicativo.
    "technical_support": ("Olá! Tudo bem?",),
    "billing": ("Olá! Tudo bem?",),
    "sales": ("Olá! Tudo bem?",),
    "general_support": ("Olá! Tudo bem?",),
}

_FRUSTRATION = re.compile(
    r"nao aguento|de novo|ja falei|ninguem resolve|cansad[oa]|irritad[oa]|urgente|"
    r"estou esperando|demora|complicado"
)

_AMBIGUOUS_GENERAL = re.compile(
    r"^(oi[, ]*)?(preciso de ajuda|me ajuda|tenho um problema|nao funciona|quero resolver|"
    r"estou com problema|deu problema)[.!? ]*$"
)

_CLARIFICATIONS: dict[str, tuple[str, ...]] = {
    "technical_support": (
        "Só para eu entender direitinho: a conexão está lenta ou ficou totalmente sem sinal?",
        "Você ainda consegue navegar, mesmo devagar, ou a internet parou completamente?",
        "O problema é de lentidão ou você ficou sem conexão?",
    ),
    "billing": (
        "Você precisa de uma segunda via ou encontrou algum valor incorreto na cobrança?",
        "Só para eu direcionar certo: é emissão de boleto ou dúvida sobre um valor cobrado?",
        "A questão é obter a fatura ou revisar uma cobrança que você não reconhece?",
    ),
    "sales": (
        "Você quer contratar um novo plano ou alterar o que já utiliza?",
        "Está procurando uma nova contratação ou uma mudança no seu plano atual?",
        "Para eu te orientar melhor: você ainda não é cliente ou deseja trocar de plano?",
    ),
    "general_support": (
        "Me conta o que aconteceu?",
        "Como posso te ajudar?",
        "O que você precisa resolver hoje?",
    ),
}

_GREETINGS = {"oi", "ola", "bom dia", "boa tarde", "boa noite"}
_SOCIAL_CHECKINS = {"tudo bem", "tudo bom", "como vai", "como voce esta", "ta tudo bem"}


def is_social_only_message(text: str, *, org_id: str | None = None) -> bool:
    """Reconhece uma abertura social inteira, inclusive mensagens agrupadas."""
    phrases = [part.strip() for part in re.split(r"[\n.!?,;]+", normalize(text)) if part.strip()]
    if not phrases or len(phrases) > 3:
        return False
    static_match = all(
        phrase in _GREETINGS
        or phrase in _SOCIAL_CHECKINS
        or bool(re.fullmatch(r"o+i+e*|o+l+a+|op+a+|e\s*a+i*|fala+|salve+", phrase))
        for phrase in phrases
    )
    if static_match or not org_id:
        return static_match
    from .language_variants import is_learned_social_greeting
    return is_learned_social_greeting(org_id, text)


def period_greeting(hour: int | None = None) -> str:
    """Usa o horário de Mato Grosso, não o relógio UTC da infraestrutura."""
    current_hour = datetime.now(ZoneInfo("America/Cuiaba")).hour if hour is None else hour
    if 5 <= current_hour < 12:
        return "Bom dia"
    if 12 <= current_hour < 18:
        return "Boa tarde"
    return "Boa noite"


def greeting_reply(text: str, conversation_id: str, *, hour: int | None = None,
                   org_id: str | None = None) -> str | None:
    """Responde cumprimentos curtos sem transformar a abertura num interrogatório."""
    if not is_social_only_message(text, org_id=org_id):
        return None
    # A abertura deve ser previsível e humana em qualquer setor. A necessidade
    # é entendida no turno seguinte, sem antecipar formulário ou diagnóstico.
    return f"{period_greeting(hour)}! Tudo bem? Como posso te ajudar?"


def conversation_level(text: str, *, clarifying: bool = False, sensitive: bool = False) -> str:
    normalized = normalize(text)
    if sensitive:
        return "cauteloso"
    if _FRUSTRATION.search(normalized):
        return "acolhedor"
    if clarifying:
        return "investigativo"
    if re.search(r"como faco|passo a passo|configurar|roteador|modem|onu\b", normalized):
        return "passo_a_passo"
    return "direto"


def first_contact_opening(intent: str, conversation_id: str, *, hour: int | None = None) -> str:
    """Saudação curta e variável usada somente na primeira resposta da conversa."""
    options = _FIRST_CONTACT_OPENINGS.get(intent, _FIRST_CONTACT_OPENINGS["general_support"])
    digest = hashlib.sha256(f"{conversation_id}:opening:{intent}".encode()).digest()
    opening = options[int.from_bytes(digest[:2], "big") % len(options)]
    opening = re.sub(r"^(?:Olá|Oi)!\s*", "", opening)
    return f"{period_greeting(hour)}! {opening}"


def needs_clarification(text: str, triage: TriageResult) -> bool:
    normalized = normalize(text).strip()
    if triage.conflict_detected:
        return True
    if triage.intent == "general_support":
        return bool(_AMBIGUOUS_GENERAL.match(normalized)) or len(normalized.split()) <= 2
    if triage.intent == "technical_support":
        return bool(
            re.search(
                r"internet (esta |ta )?(ruim|instavel)|conexao (esta |ta )?ruim|problema na internet|wifi ruim|wi-fi ruim",
                normalized,
            )
        )
    if triage.intent == "billing":
        return normalized in {"boleto", "fatura", "cobranca", "problema no boleto", "problema na fatura"}
    if triage.intent == "sales":
        return normalized in {"plano", "planos", "quero um plano", "quero mudar de plano"}
    return False


def clarification_question(
    intent: str,
    conversation_id: str,
    count: int,
    secondary_intent: str | None = None,
) -> str:
    pair = frozenset((intent, secondary_intent)) if secondary_intent else frozenset()
    if pair == frozenset(("technical_support", "billing")):
        return "Você quer que eu verifique primeiro a conexão ou a situação do pagamento?"
    if pair == frozenset(("technical_support", "sales")):
        return "Você precisa de ajuda com a conexão atual ou quer conhecer outro plano?"
    if pair == frozenset(("billing", "sales")):
        return "A sua dúvida é sobre uma cobrança atual ou sobre valores de novos planos?"
    options = _CLARIFICATIONS.get(intent, _CLARIFICATIONS["general_support"])
    digest = hashlib.sha256(f"{conversation_id}:{intent}".encode()).digest()
    start = int.from_bytes(digest[:2], "big") % len(options)
    return options[(start + count) % len(options)]


def contextual_search_query(messages: list, *, org_id: str | None = None) -> str:
    """Une somente falas recentes do cliente; respostas da IA nunca viram fatos de busca."""
    useful: list[str] = []
    for message in reversed(messages):
        if message.role != "user":
            continue
        if is_social_only_message(message.content, org_id=org_id):
            continue
        clean = semantic_search_text(message.content)
        normalized = normalize(clean).strip(" !.,?")
        if not clean or normalized in {"oi", "ola", "bom dia", "boa tarde", "boa noite"}:
            continue
        useful.append(clean)
        if len(useful) == 4:
            break
    query = " | ".join(reversed(useful))
    return query[-800:]
