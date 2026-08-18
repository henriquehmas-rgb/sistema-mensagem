"""POST /ingest — 202 imediato; processamento em background task."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, status

from .. import ingest as ingest_pipeline
from ..schemas import IngestAccepted, IngestRequest

router = APIRouter(tags=["knowledge"])


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED, response_model=IngestAccepted)
def create_ingest(payload: IngestRequest, background_tasks: BackgroundTasks) -> IngestAccepted:
    background_tasks.add_task(ingest_pipeline.run_ingest, payload)
    return IngestAccepted(source_id=payload.source_id)
