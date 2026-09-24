"""Pipeline offline e governado para históricos exportados do OPA.

Este módulo não acessa o OPA, o banco do Omni ou o RAG. Ele somente transforma
uma exportação fornecida explicitamente em candidatos anonimizados para revisão
ou em casos de replay que jamais devem ser usados como conhecimento.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import unicodedata
from dataclasses import asdict, dataclass
from typing import Any, Literal

from .routes.learning import prepare_candidate
from .schemas import LearningCandidateRequest

_EMAIL = re.compile(r"\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b", re.I)
_URL = re.compile(r"https?://\S+", re.I)
_CPF = re.compile(r"(?<!\d)\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}(?!\d)")
_LONG_NUMBER = re.compile(r"(?<!\d)\d(?:[\s.-]?\d){7,}(?!\d)")
_SECRET = re.compile(
    r"\b(?:token|senha|password|api[ _-]?key|chave)\s*[:=]\s*\S+", re.I
)
_NAME_DECLARATION = re.compile(r"\b(?:meu nome [ée]|sou o|sou a)\s+[A-ZÁÀÂÃÉÈÊÍÏÓÔÕÖÚÇ][\wÀ-ÿ'-]+", re.I)
_COMMERCIAL_RISK = re.compile(r"\b(desconto|cortesia|preço especial|valor promocional)\b", re.I)
_UNCERTAIN = re.compile(r"\b(acho|talvez|provavelmente|não sei|nao sei)\b", re.I)
_ROBOTIC_MENU_LOOP = re.compile(
    r"\b(?:op[cç][aã]o inv[aá]lida|selecione ou digite uma das op[cç][oõ]es|"
    r"responda (?:1|2|sim ou n[aã]o))\b",
    re.I,
)
_HUMAN_REQUEST = re.compile(
    r"\b(?:falar\s+com\s+(?:um\s+)?atendente|atendimento\s+humano|"
    r"falar\s+com\s+uma\s+pessoa|pessoa\s+de\s+verdade)\b",
    re.I,
)
_UNSUPPORTED_OPERATIONAL_COMMITMENT = re.compile(
    r"\b(?:vou\s+(?:realizar|encaminhar|liberar|desbloquear|ativar|alterar)|"
    r"(?:verificamos|identificamos)\s+que|desbloqueio\s+(?:por|em)\s+confian[cç]a)\b",
    re.I,
)

_DEPARTMENT_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("support", re.compile(r"\b(internet|conex[aã]o|sinal|wifi|roteador|lent|offline|t[eé]cnico|os\b)\b", re.I)),
    ("financial", re.compile(r"\b(fatura|boleto|pagamento|vencimento|segunda via|nota fiscal)\b", re.I)),
    ("sales", re.compile(r"\b(plano|cobertura|contratar|upgrade|cancelamento|reten[cç][aã]o)\b|internet\s+comercial|internet\s+para\s+empresa", re.I)),
]


@dataclass(frozen=True)
class OpaMessage:
    role: Literal["customer", "agent"]
    content: str
    created_at: str | None = None


@dataclass(frozen=True)
class OpaConversation:
    source_id: str
    messages: list[OpaMessage]
    department: str | None = None
    status: str | None = None


@dataclass(frozen=True)
class PreparedOpaItem:
    source_ref: str
    department: Literal["support", "financial", "sales", "unknown"]
    question: str
    answer: str
    disposition: Literal["REVIEW_PENDING", "REPLAY_ONLY", "QUARANTINED"]
    quality_score: float
    rejection_reasons: list[str]
    fingerprint: str | None
    rag_publish_allowed: Literal[False] = False


@dataclass(frozen=True)
class HumanizationAutoLearningAssessment:
    """Decisão auditável para aprendizagem automática estritamente linguística.

    Esta avaliação não publica nada no RAG e nunca libera procedimento, preço,
    prazo, OS ou chamado. Ela indica apenas que uma variação de linguagem pode
    seguir para a camada futura de humanização, quando validada contra fontes
    oficiais e cenários de replay.
    """

    eligible: bool
    semantic_compatibility: float
    source_compatibility: float
    rejection_reasons: list[str]


_AUTO_LEARNING_RISK = re.compile(
    r"\b(?:ordem de servi[cç]o|\bos\b|chamado|ticket|prazo|visita|"
    r"desconto|pre[cç]o|valor|boleto|pix|reembolso|cancelamento|"
    r"contrato|fatura|pagamento)\b",
    re.I,
)


def assess_humanization_auto_learning(
    item: PreparedOpaItem,
    *,
    semantic_compatibility: float,
    source_compatibility: float,
    replay_passed: bool,
    conflict_free: bool,
) -> HumanizationAutoLearningAssessment:
    """Aplica o limiar de 90% sem transformar estilo em regra operacional.

    ``semantic_compatibility`` compara a resposta com linguagem já aprovada.
    ``source_compatibility`` é produzido pelo validador que confronta o contexto
    com IXC/Olho de Deus e protocolos. Ambos precisam atingir 90%; não existe
    média compensatória entre uma fonte fraca e outra forte.
    """

    reasons: list[str] = []
    if item.disposition != "REVIEW_PENDING":
        reasons.append("not_review_candidate")
    if item.department != "support":
        reasons.append("outside_support_pilot")
    if semantic_compatibility < 0.90:
        reasons.append("semantic_compatibility_below_90")
    if source_compatibility < 0.90:
        reasons.append("source_compatibility_below_90")
    if not replay_passed:
        reasons.append("replay_not_approved")
    if not conflict_free:
        reasons.append("official_source_conflict")
    if "[" in item.question or "[" in item.answer:
        reasons.append("redacted_sensitive_marker_present")
    if _AUTO_LEARNING_RISK.search(f"{item.question} {item.answer}"):
        reasons.append("operational_or_commercial_content")

    return HumanizationAutoLearningAssessment(
        eligible=not reasons,
        semantic_compatibility=semantic_compatibility,
        source_compatibility=source_compatibility,
        rejection_reasons=reasons,
    )


def sanitize_text(value: str) -> str:
    text = " ".join(value.split()).strip()
    for pattern, replacement in (
        (_SECRET, "[SEGREDO_REMOVIDO]"),
        (_EMAIL, "[EMAIL_REMOVIDO]"),
        (_URL, "[URL_REMOVIDA]"),
        (_CPF, "[DOCUMENTO_REMOVIDO]"),
        (_LONG_NUMBER, "[IDENTIFICADOR_REMOVIDO]"),
        (_NAME_DECLARATION, "meu nome é [NOME_REMOVIDO]"),
    ):
        text = pattern.sub(replacement, text)
    return text


def _normalized(value: str) -> str:
    return unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()


def classify_department(question: str, answer: str, declared: str | None = None) -> str:
    declared_normalized = _normalized(declared or "")
    aliases = {
        "suporte": "support", "support": "support", "financeiro": "financial",
        "financial": "financial", "vendas": "sales", "comercial": "sales", "sales": "sales",
    }
    if declared_normalized in aliases:
        return aliases[declared_normalized]
    combined = f"{question} {answer}"
    # "Internet comercial" descreve uma intenção de contratação, embora a
    # palavra isolada "internet" também exista no vocabulário de Suporte.
    if re.search(r"internet\s+(?:comercial|para\s+empresa)", combined, re.I):
        return "sales"
    matches = [department for department, pattern in _DEPARTMENT_RULES if pattern.search(combined)]
    return matches[0] if len(matches) == 1 else "unknown"


def _source_ref(source_id: str, salt: str) -> str:
    return "opa_" + hmac.new(salt.encode(), source_id.encode(), hashlib.sha256).hexdigest()[:24]


def _split(fingerprint: str, salt: str) -> Literal["REVIEW_PENDING", "REPLAY_ONLY"]:
    digest = hmac.new(salt.encode(), fingerprint.encode(), hashlib.sha256).digest()
    return "REPLAY_ONLY" if int.from_bytes(digest[:2], "big") % 5 == 0 else "REVIEW_PENDING"


def _pairs(messages: list[OpaMessage]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    pending_customer: list[str] = []
    for message in messages:
        if message.role == "customer":
            pending_customer.append(message.content)
        elif pending_customer:
            pairs.append((" ".join(pending_customer), message.content))
            pending_customer = []
    return pairs


def prepare_conversation(conversation: OpaConversation, salt: str) -> list[PreparedOpaItem]:
    if len(salt) < 16:
        raise ValueError("O salt de pseudonimização deve possuir ao menos 16 caracteres")
    prepared: list[PreparedOpaItem] = []
    source_ref = _source_ref(conversation.source_id, salt)
    for raw_question, raw_answer in _pairs(conversation.messages):
        question, answer = sanitize_text(raw_question), sanitize_text(raw_answer)
        department = classify_department(question, answer, conversation.department)
        reasons: list[str] = []
        if department == "unknown":
            reasons.append("department_ambiguous")
        if _COMMERCIAL_RISK.search(answer):
            reasons.append("commercial_commitment_requires_review")
        if _UNCERTAIN.search(answer):
            reasons.append("uncertain_human_answer")
        # Históricos não são autoridade para afirmar estado de contrato, nem
        # para ensinar que a IA pode executar ou prometer uma ação externa.
        # Esses pares ainda servem como evidência de má conduta e regressão.
        if _UNSUPPORTED_OPERATIONAL_COMMITMENT.search(answer):
            reasons.append("unsupported_operational_commitment")
        # Este é um sinal histórico de que um menu não compreendeu texto livre.
        # É útil para criar regressões, mas jamais para ensinar a resposta ao cliente.
        if _ROBOTIC_MENU_LOOP.search(answer):
            reasons.append("robotic_menu_loop")
            if _HUMAN_REQUEST.search(question):
                reasons.append("human_request_ignored_by_menu")

        candidate = prepare_candidate(LearningCandidateRequest(question=question, answer=answer))
        if not candidate.eligible:
            reasons.append(candidate.rejection_reason or "learning_candidate_rejected")
        fingerprint = candidate.fingerprint
        disposition: Literal["REVIEW_PENDING", "REPLAY_ONLY", "QUARANTINED"]
        if reasons or not fingerprint:
            disposition = "QUARANTINED"
        else:
            disposition = _split(fingerprint, salt)
        prepared.append(PreparedOpaItem(
            source_ref=source_ref,
            department=department,  # type: ignore[arg-type]
            question=question,
            answer=answer,
            disposition=disposition,
            quality_score=candidate.quality_score,
            rejection_reasons=sorted(set(reasons)),
            fingerprint=fingerprint,
        ))
    return prepared


def prepare_export(payload: dict[str, Any] | list[Any], salt: str) -> dict[str, Any]:
    records = payload.get("conversations", []) if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        raise ValueError("A exportação deve conter uma lista de conversas")
    items: list[PreparedOpaItem] = []
    for record in records:
        if not isinstance(record, dict) or not str(record.get("id", "")).strip():
            continue
        messages: list[OpaMessage] = []
        for message in record.get("messages", []):
            if not isinstance(message, dict):
                continue
            raw_role = str(message.get("role") or message.get("direction") or "").lower()
            role = "customer" if raw_role in {"customer", "client", "inbound", "user"} else "agent"
            content = str(message.get("content") or message.get("text") or "").strip()
            if content:
                messages.append(OpaMessage(role=role, content=content, created_at=message.get("createdAt")))
        items.extend(prepare_conversation(OpaConversation(
            source_id=str(record["id"]), messages=messages,
            department=record.get("department"), status=record.get("status"),
        ), salt))
    counts = {key: sum(item.disposition == key for item in items) for key in (
        "REVIEW_PENDING", "REPLAY_ONLY", "QUARANTINED"
    )}
    return {
        "schema_version": 1,
        "source": "OPA_OFFLINE_EXPORT",
        "runtime_dependency": False,
        "automatic_rag_publication": False,
        "counts": counts,
        "items": [asdict(item) for item in items],
    }
