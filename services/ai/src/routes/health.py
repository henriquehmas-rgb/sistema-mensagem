"""GET /health — publica (sem X-Service-Token)."""

from __future__ import annotations

from fastapi import APIRouter

from .. import db
from ..config import get_settings
from ..schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    db_ok = db.healthcheck()
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        provider=settings.ai_provider,
        db=db_ok,
    )
