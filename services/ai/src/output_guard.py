"""Inspeção determinística da resposta antes de enviá-la ao cliente."""

from __future__ import annotations

import re

from .textutils import normalize

_ALWAYS_BLOCKED = re.compile(
    r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)"  # CPF
    r"|(?:\d[\s.\-]?){13,18}\d"  # cartão
    r"|\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b"  # MAC
    r"|\b(?:token|senha|password|cvv|cvc)\s*[:=]"
    r"|\b000201\d{10,}"  # payload Pix EMV
)

_PROTECTED_WITHOUT_IDENTITY = re.compile(
    r"\br\$\s*\d|\bvencimento\s+(?:e|eh|sera|foi)\b"
    r"|\bfatura\s+(?:esta|de|do|numero)\b"
    r"|\bcontrato\s+(?:numero|n[ºo]|esta)\b"
    r"|\b(?:chamado|protocolo)\s+(?:numero|n[ºo]|\d)"
)

_COMMERCIAL_COMMITMENT = re.compile(
    r"(?:conceder|aplicar|oferecer|garantir|liberar)(?:emos|ei|ia|o)?\s+.*?desconto"
    r"|desconto\s+(?:de\s+)?\d+(?:[,.]\d+)?\s*%"
    r"|(?:valor|preco|condicao)\s+especial\s+(?:de\s+)?r\$"
    r"|(?:faco|fazemos|consigo fazer)\s+por\s+r\$"
)


def inspect_reply(
    text: str, *, identity_verified: bool, commercial_reviewed: bool = False
) -> str | None:
    normalized = normalize(text)
    if _ALWAYS_BLOCKED.search(normalized):
        return "resposta_contem_dado_sensivel"
    if not identity_verified and _PROTECTED_WITHOUT_IDENTITY.search(normalized):
        return "resposta_protegida_sem_identidade_validada"
    if not commercial_reviewed and _COMMERCIAL_COMMITMENT.search(normalized):
        return "condicao_comercial_sem_revisao_humana"
    return None
