"""Fixtures dos testes — sem rede, provider mock, DB inalcancavel por padrao."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.config import get_settings

TEST_TOKEN = "test-service-token"


@pytest.fixture()
def app(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", TEST_TOKEN)
    monkeypatch.setenv("AI_PROVIDER", "mock")
    # Porta improvavel: qualquer acesso acidental ao DB falha rapido.
    monkeypatch.setenv("DATABASE_URL", "postgresql://sm:sm@127.0.0.1:59999/sm?schema=public")
    get_settings.cache_clear()

    from src.app import create_app

    application = create_app()
    yield application
    get_settings.cache_clear()


@pytest.fixture()
def client(app) -> TestClient:
    return TestClient(app)


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"X-Service-Token": TEST_TOKEN}
