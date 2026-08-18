"""Aplicacao FastAPI do servico de IA (porta interna 8100).

Execucao local: ``uvicorn src.app:app --host 0.0.0.0 --port 8100``
Todas as rotas exigem X-Service-Token, exceto GET /health.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI

from . import db
from .auth import require_service_token
from .routes.health import router as health_router
from .routes.ingest import router as ingest_router
from .routes.query import router as query_router
from .routes.reply import router as reply_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

logger = logging.getLogger(__name__)


def _fail_orphaned_processing_sources() -> None:
    """Recupera fontes presas em PROCESSING apos restart/deploy.

    A ingestao roda in-process (BackgroundTasks apos o 202); o job
    knowledge-ingest do BullMQ ja foi concluido com o 202, entao NAO ha retry.
    Qualquer fonte ainda PROCESSING no boot foi interrompida e nunca sera
    retomada — marcamos como FAILED para a UI nao mostrar ingestao eterna.
    """
    try:
        recovered = db.execute(
            """
            UPDATE knowledge_sources
            SET status = 'FAILED',
                meta = COALESCE(meta, '{}'::jsonb) || %s::jsonb,
                updated_at = now()
            WHERE status = 'PROCESSING'
            """,
            (json.dumps({"error": "ingestao interrompida por restart do servico"}),),
        )
        if recovered:
            logger.warning(
                "startup: %d fonte(s) presas em PROCESSING marcadas como FAILED", recovered
            )
    except Exception:  # noqa: BLE001 — startup nunca falha por DB indisponivel
        logger.exception("startup: falha ao recuperar fontes presas em PROCESSING")


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    _fail_orphaned_processing_sources()
    try:
        yield
    finally:
        db.close_pool()


def create_app() -> FastAPI:
    app = FastAPI(
        title="SEEG Omni — AI Service",
        version="1.0.0",
        lifespan=_lifespan,
    )

    app.include_router(health_router)

    protected = APIRouter(dependencies=[Depends(require_service_token)])
    protected.include_router(ingest_router)
    protected.include_router(query_router)
    protected.include_router(reply_router)
    app.include_router(protected)

    return app


app = create_app()
