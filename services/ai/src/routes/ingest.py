"""POST /ingest — 202 imediato; processamento em background task."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, status

from .. import ingest as ingest_pipeline
from ..schemas import IngestAccepted, IngestRequest
from ..usage_tracker import usage_scope

router = APIRouter(tags=["knowledge"])


def _run_ingest_with_usage(payload: IngestRequest) -> None:
    with usage_scope(payload.org_id, "knowledge_ingest"):
        ingest_pipeline.run_ingest(payload)


@router.post("/ingest", status_code=status.HTTP_202_ACCEPTED, response_model=IngestAccepted)
def create_ingest(payload: IngestRequest, background_tasks: BackgroundTasks) -> IngestAccepted:
    background_tasks.add_task(_run_ingest_with_usage, payload)
    return IngestAccepted(source_id=payload.source_id)
