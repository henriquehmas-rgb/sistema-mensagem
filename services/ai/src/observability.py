"""Sentry opcional (CONTRACTS §14): NO-OP TOTAL quando SENTRY_DSN esta vazio
— mesmo padrao do servico api (SentryService): `sentry_sdk` so e importado
dentro de `init_sentry()`, entao o SDK nunca carrega no processo se a env
var nao estiver configurada.

Quando habilitado:
- `FastApiIntegration`/`StarletteIntegration` (auto-detectadas pelo SDK por
  fastapi/starlette estarem instalados) capturam excecoes nao tratadas das
  rotas — equivalente ao `SentryExceptionFilter` da api.
- `ExcepthookIntegration` (integracao default do SDK, sempre ativa) instala
  um `sys.excepthook` que captura excecoes verdadeiramente nao tratadas do
  processo — o equivalente Python mais proximo do `uncaughtException` do
  Node.
- O handler global `Exception` registrado por `install_exception_handler`
  (chamado em app.py) garante a captura mesmo se a auto-instrumentacao nao
  cobrir algum caminho (ex.: excecao levantada dentro de um BackgroundTask
  ja fora do ciclo request/response) — sempre re-levanta a excecao original
  depois, entao o comportamento de resposta do FastAPI NUNCA muda.
- `before_send` redige accessToken/password/Authorization (e variacoes) de
  exception/extra/request/contexts antes do evento sair da organizacao —
  mesma politica do AppLogger/SentryService da api, para nao duplicar chaves
  sensiveis em dois lugares.
"""

from __future__ import annotations

import logging
from typing import Any

from .config import get_settings

logger = logging.getLogger(__name__)

_enabled = False

_SENSITIVE_KEYS = frozenset(
    {
        "accesstoken",
        "access_token",
        "password",
        "authorization",
        "refreshtoken",
        "refresh_token",
        "encryptedcredentials",
        "apikey",
        "api_key",
        "secret",
        "clientsecret",
        "client_secret",
        "visitortoken",
        "x-service-token",
    }
)

_MAX_DEPTH = 6


def _scrub(value: Any, depth: int = 0) -> Any:
    if depth >= _MAX_DEPTH or not isinstance(value, (dict, list)):
        return value
    if isinstance(value, list):
        return [_scrub(item, depth + 1) for item in value]
    return {
        key: ("[REDACTED]" if str(key).lower() in _SENSITIVE_KEYS else _scrub(val, depth + 1))
        for key, val in value.items()
    }


def scrub_event(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
    """`before_send` do Sentry — redige os trechos do evento que podem carregar
    credenciais, preservando o restante (tags, breadcrumbs, level, sdk) intacto.
    """
    for key in ("exception", "extra", "request", "contexts"):
        if event.get(key) is not None:
            event[key] = _scrub(event[key])
    return event


def init_sentry() -> bool:
    """Inicializa o sentry-sdk quando SENTRY_DSN esta configurado. Retorna
    True se habilitado. Nunca lanca — observabilidade nao pode derrubar o
    boot do servico.
    """
    global _enabled
    settings = get_settings()
    if not settings.sentry_dsn:
        return False

    try:
        import sentry_sdk

        sentry_sdk.init(dsn=settings.sentry_dsn, before_send=scrub_event)
        _enabled = True
        logger.info("Sentry habilitado (SENTRY_DSN configurado)")
    except Exception:  # noqa: BLE001 — observabilidade nunca derruba o boot
        logger.exception("falha ao inicializar o Sentry — seguindo sem ele")
        _enabled = False

    return _enabled


def is_enabled() -> bool:
    return _enabled


def capture_exception(exc: BaseException) -> None:
    """No-op quando Sentry desabilitado — mesmo contrato de SentryService.captureException."""
    if not _enabled:
        return
    import sentry_sdk

    sentry_sdk.capture_exception(exc)
