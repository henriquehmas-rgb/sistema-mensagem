"""Equivalências sociais por organização, carregadas fora do caminho da resposta."""

from __future__ import annotations

import logging
import re
import threading

from . import db
from .textutils import normalize

logger = logging.getLogger(__name__)
_active_by_org: dict[str, frozenset[str]] = {}
_lock = threading.Lock()
_REFRESH_SECONDS = 300
_SOCIAL_REFERENCES = (
    "oi", "ola", "opa", "e ai", "eai beleza", "tudo bem", "tudo bom",
    "como vai", "bom dia", "boa tarde", "boa noite",
)
_BUSINESS_OR_SENSITIVE = re.compile(
    r"\b(?:internet|conexao|sem|sinal|los|roteador|modem|fatura|boleto|pix|cpf|cnpj|"
    r"cadastro|contrato|plano|comprar|contratar|preco|valor|cobertura|endereco|cep|"
    r"tecnico|chamado|visita|prazo|senha|token|ajuda|problema)\b"
)


def _similarity(left: str, right: str) -> float:
    """Mesmo limiar de edição usado pelo minerador em lote no backend."""
    previous = list(range(len(right) + 1))
    for row, char in enumerate(left, 1):
        current = [row]
        for col, other in enumerate(right, 1):
            current.append(min(
                previous[col] + 1,
                current[col - 1] + 1,
                previous[col - 1] + (char != other),
            ))
        previous = current
    return 1 - previous[-1] / max(len(left), len(right))


def refresh_social_variants() -> bool:
    """Troca o snapshot inteiro só após uma leitura bem-sucedida."""
    try:
        rows = db.fetch_all(
            """SELECT org_id, normalized_text FROM language_variants
               WHERE kind = 'SOCIAL_GREETING' AND status = 'ACTIVE' LIMIT 10000"""
        )
    except Exception:
        logger.warning("Atualização das variações sociais indisponível; snapshot anterior preservado")
        return False
    next_snapshot: dict[str, set[str]] = {}
    for org_id, phrase in rows:
        if isinstance(org_id, str) and isinstance(phrase, str):
            next_snapshot.setdefault(org_id, set()).add(phrase)
    with _lock:
        global _active_by_org
        _active_by_org = {org: frozenset(phrases) for org, phrases in next_snapshot.items()}
    return True


def start_social_variant_refresh() -> tuple[threading.Event, threading.Thread]:
    """Atualiza o snapshot em segundo plano a cada cinco minutos."""
    stop = threading.Event()

    def run() -> None:
        while not stop.wait(_REFRESH_SECONDS):
            refresh_social_variants()

    worker = threading.Thread(target=run, name="social-variant-refresh", daemon=True)
    worker.start()
    return stop, worker


def is_learned_social_greeting(org_id: str, text: str) -> bool:
    """Lookup em memória; falha fechada e nunca escolhe um setor."""
    if not org_id or len(text) > 60 or re.search(r"\d|[@/\\\[\]:#$]", text):
        return False
    phrase = re.sub(r"[^a-z\s]", " ", normalize(text))
    phrase = " ".join(phrase.split())
    if not 3 <= len(phrase) <= 40 or _BUSINESS_OR_SENSITIVE.search(phrase):
        return False
    if max(_similarity(phrase, reference) for reference in _SOCIAL_REFERENCES) < 0.82:
        return False
    with _lock:
        return phrase in _active_by_org.get(org_id, frozenset())
