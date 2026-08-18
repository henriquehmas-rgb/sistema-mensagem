"""CONTRACTS §14: Sentry opcional no serviço de ia — no-op total quando
SENTRY_DSN está vazio; quando habilitado, nunca deixa credenciais/PII saírem
da organização (mesma política de redação do AppLogger/SentryService da api,
reaproveitada aqui via scrub_event em vez de duplicada).
"""

from __future__ import annotations

import pytest

from src import observability
from src.config import get_settings


@pytest.fixture(autouse=True)
def _reset_observability_state(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(observability, "_enabled", False)
    yield
    monkeypatch.setattr(observability, "_enabled", False)
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    get_settings.cache_clear()


def test_init_sentry_no_op_quando_sentry_dsn_ausente(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    get_settings.cache_clear()

    assert observability.init_sentry() is False
    assert observability.is_enabled() is False


def test_init_sentry_no_op_quando_sentry_dsn_e_string_vazia(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SENTRY_DSN", "")
    get_settings.cache_clear()

    assert observability.init_sentry() is False
    assert observability.is_enabled() is False


def test_capture_exception_nunca_lanca_quando_desabilitado() -> None:
    observability.capture_exception(RuntimeError("boom"))  # não deve lançar


def test_init_sentry_habilita_e_configura_before_send_quando_dsn_presente(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SENTRY_DSN", "https://key@sentry.io/1")
    get_settings.cache_clear()

    import sentry_sdk

    calls: list[dict[str, object]] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))

    assert observability.init_sentry() is True
    assert observability.is_enabled() is True
    assert calls[0]["dsn"] == "https://key@sentry.io/1"
    assert calls[0]["before_send"] is observability.scrub_event


def test_capture_exception_delega_ao_sdk_quando_habilitado(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SENTRY_DSN", "https://key@sentry.io/1")
    get_settings.cache_clear()

    import sentry_sdk

    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: None)
    captured: list[BaseException] = []
    monkeypatch.setattr(sentry_sdk, "capture_exception", lambda exc: captured.append(exc))

    observability.init_sentry()
    error = RuntimeError("falha não tratada")
    observability.capture_exception(error)

    assert captured == [error]


def test_scrub_event_redige_exception_extra_request_contexts_preservando_o_resto() -> None:
    event = {
        "level": "error",
        "tags": {"env": "production"},
        "exception": {
            "values": [
                {
                    "type": "Error",
                    "value": "request failed",
                    # propriedades extras anexadas ao erro original (ex.: httpx/requests)
                    "config": {"headers": {"authorization": "Bearer super-secret-meta-token"}},
                }
            ]
        },
        "extra": {"accessToken": "plain-secret", "orgId": "org1"},
        "request": {"headers": {"Authorization": "Bearer x"}, "url": "/reply"},
        "contexts": {"app": {"password": "hunter2"}},
    }

    result = observability.scrub_event(event, {})

    assert result["exception"]["values"][0]["config"]["headers"]["authorization"] == "[REDACTED]"
    assert result["extra"]["accessToken"] == "[REDACTED]"
    assert result["extra"]["orgId"] == "org1"
    assert result["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert result["request"]["url"] == "/reply"
    assert result["contexts"]["app"]["password"] == "[REDACTED]"
    # campos fora do escopo de redação continuam intactos
    assert result["level"] == "error"
    assert result["tags"] == {"env": "production"}
