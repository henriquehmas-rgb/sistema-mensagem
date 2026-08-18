"""Autenticacao interna por header X-Service-Token (CONTRACTS §7)."""

from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from .config import Settings, get_settings


def require_service_token(
    settings: Annotated[Settings, Depends(get_settings)],
    x_service_token: Annotated[str | None, Header(alias="X-Service-Token")] = None,
) -> None:
    """Exige `X-Service-Token == AI_SERVICE_TOKEN` em todas as rotas (exceto /health).

    Fail-closed: sem AI_SERVICE_TOKEN configurado, toda requisicao e rejeitada.
    Comparacao em tempo constante para evitar timing attacks.
    """
    expected = settings.ai_service_token
    provided = x_service_token or ""
    if not expected or not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Service-Token",
        )
