"""CONTRACTS §14: toda exceção não tratada de uma rota do serviço de ia
precisa ser capturada no Sentry (via src.observability.capture_exception,
no-op quando SENTRY_DSN vazio) SEM alterar o comportamento padrão de resposta
do FastAPI para exceções não tratadas — mesmo padrão do SentryExceptionFilter
da api (captura e sempre delega/re-levanta).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_excecao_nao_tratada_e_capturada_e_ainda_recebe_resposta_500(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: list[BaseException] = []
    monkeypatch.setattr("src.app.capture_exception", lambda exc: captured.append(exc))

    @app.get("/__test-unhandled-boom")
    def _boom():
        raise RuntimeError("boom inesperado")

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/__test-unhandled-boom")

    assert response.status_code == 500
    assert len(captured) == 1
    assert isinstance(captured[0], RuntimeError)
    assert str(captured[0]) == "boom inesperado"
