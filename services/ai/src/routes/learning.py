"""Prepara repertório humano para revisão, sem publicar diretamente no RAG."""

from __future__ import annotations

import re
import hashlib
import unicodedata

from fastapi import APIRouter

from ..handoff import detect_sensitive_data
from ..schemas import LearningCandidateRequest, LearningCandidateResponse

router = APIRouter(tags=["learning"])

_CONTACT_DATA = re.compile(
    r"\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|(?:\+?\d[\s().-]?){8,}\d|https?://",
    re.IGNORECASE,
)
_LOW_VALUE = re.compile(r"^(oi|olá|ola|ok|certo|pronto|resolvido|obrigad[oa]|por nada)[.! ]*$", re.I)
_UNCERTAIN = re.compile(r"\b(acho|talvez|provavelmente|vou verificar|não sei|nao sei|exceção|excecao|cortesia)\b", re.I)
_ACTIONABLE = re.compile(r"\b(acesse|abra|clique|reinicie|desligue|ligue|envie|selecione|configure|aguarde|solicite|gere|atualize)\b", re.I)
_OUT_OF_SUPPORT_DOMAIN = re.compile(
    r"\b(carteira de trabalho|contracheque|rescis[aã]o|ass[eé]dio moral|"
    r"p[oó]s[- ]gradua[cç][aã]o|faculdade|filiad[oa]s?|dependente)\b",
    re.I,
)
_SUPPORT_SIGNAL = re.compile(
    r"\b(internet|conex[aã]o|wi-?fi|roteador|modem|onu|los|pon|sinal|"
    r"lenti[dã]o|instabili[dz]ade|equipamento|aplicativo|telefone|telefonia|chamado|ordem de servi[cç]o)\b",
    re.I,
)
_MISMATCHED_SUPPORT_TOPIC = re.compile(r"hor[aá]rio de atendimento", re.I)
_AUTO_REVIEW_BLOCKLIST = re.compile(
    r"\b(cobertura|disponibilidade|viabilidade|cep|endere[c�]o|pre[c�]o|valor|desconto|"
    r"plano|velocidade|contrato|fatura|boleto|pagamento|pix|cpf|cnpj|cadastro|"
    r"visita|instala[c�][a�]o|prazo|agendamento|ordem de servi[c�]o|conta|cliente)\b",
    re.I,
)
_STOPWORDS = {"a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "um", "uma", "para", "por", "com", "que", "como"}


def _fingerprint(question: str, answer: str) -> str:
    raw = unicodedata.normalize("NFKD", f"{question} {answer}").encode("ascii", "ignore").decode().lower()
    tokens = sorted({token for token in re.findall(r"[a-z0-9]+", raw) if len(token) > 2 and token not in _STOPWORDS})
    return hashlib.sha256(" ".join(tokens).encode()).hexdigest()


@router.post("/learning/candidate", response_model=LearningCandidateResponse)
def prepare_candidate(payload: LearningCandidateRequest) -> LearningCandidateResponse:
    question = " ".join(payload.question.split()).strip()
    answer = " ".join(payload.answer.split()).strip()
    if len(question) < 8 or len(answer) < 12:
        return LearningCandidateResponse(eligible=False, rejection_reason="conteudo_insuficiente")
    if detect_sensitive_data(question) or detect_sensitive_data(answer):
        return LearningCandidateResponse(eligible=False, rejection_reason="dado_sensivel")
    if _CONTACT_DATA.search(question) or _CONTACT_DATA.search(answer):
        return LearningCandidateResponse(eligible=False, rejection_reason="dado_de_contato_ou_url")
    if _LOW_VALUE.fullmatch(answer):
        return LearningCandidateResponse(eligible=False, rejection_reason="resposta_sem_repertorio")
    if payload.department_key == "technical_support":
        combined = f"{question}\n{answer}"
        if _OUT_OF_SUPPORT_DOMAIN.search(combined) or not _SUPPORT_SIGNAL.search(combined):
            return LearningCandidateResponse(eligible=False, rejection_reason="dominio_incompativel")
        if _MISMATCHED_SUPPORT_TOPIC.search(question) and _SUPPORT_SIGNAL.search(answer):
            return LearningCandidateResponse(eligible=False, rejection_reason="pergunta_resposta_incoerentes")

    quality = 0.55
    if len(question) >= 15:
        quality += 0.1
    if len(answer) >= 30:
        quality += 0.15
    if _ACTIONABLE.search(answer):
        quality += 0.15
    if _UNCERTAIN.search(answer):
        quality -= 0.25
    quality = round(max(0.0, min(1.0, quality)), 2)
    if quality < 0.65:
        return LearningCandidateResponse(eligible=False, rejection_reason="baixa_qualidade", quality_score=quality)
    return LearningCandidateResponse(
        eligible=True,
        content=f"Pergunta recorrente: {question}\nResposta registrada por atendente: {answer}",
        quality_score=quality,
        fingerprint=_fingerprint(question, answer),
        # Uso provis�rio é estritamente suporte técnico, procedural e sem fatos
        # comerciais, financeiros, cadastrais ou pessoais. Todo item continua
        # obrigatoriamente na revisão humana semanal.
        auto_publish_eligible=(
            payload.department_key == "technical_support"
            and quality >= 0.85
            and bool(_ACTIONABLE.search(answer))
            and not bool(_AUTO_REVIEW_BLOCKLIST.search(f"{question}\n{answer}"))
        ),
    )
