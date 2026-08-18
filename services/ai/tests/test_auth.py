"""Auth: X-Service-Token obrigatorio em todas as rotas exceto /health."""

from __future__ import annotations

import pytest

from src import db

HANDOFF_BODY = {
    "org_id": "org_1",
    "conversation_id": "conv_1",
    "messages": [{"role": "user", "content": "Quero falar com um atendente agora"}],
    "contact": {"name": "Ana"},
}


def test_health_is_public_and_degraded_without_db(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db, "healthcheck", lambda: False)
    response = client.get("/health")
    assert response.status_code == 200  # HTTP 200 sempre (CONTRACTS §6); campo status sinaliza
    body = response.json()
    assert body["status"] == "degraded"
    assert body["provider"] == "mock"
    assert body["db"] is False


def test_health_ok_with_db(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(db, "healthcheck", lambda: True)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["db"] is True


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/reply", HANDOFF_BODY),
        ("post", "/query", {"org_id": "org_1", "query": "horario"}),
        (
            "post",
            "/ingest",
            {"org_id": "org_1", "source_id": "src_1", "type": "TEXT", "content_text": "abc"},
        ),
    ],
)
def test_missing_token_is_401(client, method: str, path: str, body: dict) -> None:
    response = getattr(client, method)(path, json=body)
    assert response.status_code == 401


def test_wrong_token_is_401(client) -> None:
    response = client.post(
        "/reply", json=HANDOFF_BODY, headers={"X-Service-Token": "wrong-token"}
    )
    assert response.status_code == 401


def test_valid_token_is_200(client, auth_headers) -> None:
    # /reply com pedido de humano: heuristica pre-LLM responde sem tocar DB/LLM.
    response = client.post("/reply", json=HANDOFF_BODY, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["handoff"] is True


def test_ingest_returns_202_and_schedules_background_task(
    client, auth_headers, monkeypatch: pytest.MonkeyPatch
) -> None:
    from src.routes import ingest as ingest_route

    calls: list[str] = []
    monkeypatch.setattr(
        ingest_route.ingest_pipeline, "run_ingest", lambda payload: calls.append(payload.source_id)
    )
    response = client.post(
        "/ingest",
        json={"org_id": "org_1", "source_id": "src_9", "type": "TEXT", "content_text": "conteudo"},
        headers=auth_headers,
    )
    assert response.status_code == 202
    assert response.json() == {"status": "accepted", "source_id": "src_9"}
    assert calls == ["src_9"]  # TestClient executa background tasks apos a resposta


def test_ingest_validates_content_fields(client, auth_headers) -> None:
    response = client.post(
        "/ingest",
        json={"org_id": "org_1", "source_id": "src_1", "type": "PDF"},  # sem content_url
        headers=auth_headers,
    )
    assert response.status_code == 422
