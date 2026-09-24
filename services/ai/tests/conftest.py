"""Fixtures dos testes — sem rede, provider mock, DB inalcancavel por padrao."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.config import get_settings

TEST_TOKEN = "test-service-token"


@pytest.fixture(autouse=True)
def isolated_test_settings(monkeypatch: pytest.MonkeyPatch):
    """Impede que qualquer teste herde provedores ou chaves do ambiente real."""
    monkeypatch.setenv("AI_PROVIDER", "mock")
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql://sm:sm@127.0.0.1:59999/sm?schema=public"
    )
    # A imagem de produção tem um .env próprio. Fixar o piloto torna a suíte
    # independente da configuração real; cenários setoriais o sobrescrevem.
    monkeypatch.setenv("PILOT_ROUTE_KEY", "technical_support")
    monkeypatch.setenv("PILOT_ROUTE_KEYS", "technical_support")
    for name in (
        "AI_PRIMARY_PROVIDER",
        "AI_AUXILIARY_PROVIDER",
        "AI_REVIEW_PROVIDER",
        "AI_FALLBACK_PROVIDER",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def app(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AI_SERVICE_TOKEN", TEST_TOKEN)
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
