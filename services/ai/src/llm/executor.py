"""Executor COMPARTILHADO para chamadas de LLM com timeout rigido.

Usado por /reply e /memory/summarize (e qualquer outra rota que chame um
ChatProvider). Criar um ThreadPoolExecutor por request/rota vazaria threads
nao-daemon a cada timeout (cancel_futures nao interrompe uma future JA em
execucao). Com o pool fixo e compartilhado entre rotas, no pior caso ficam
max_workers threads ocupadas ate o timeout do proprio client do provedor
encerrar a chamada — esse timeout e configurado com llm_timeout_seconds
(mantidos alinhados; ver get_chat_provider).
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from .base import ChatMessage, ChatProvider

_LLM_EXECUTOR = ThreadPoolExecutor(max_workers=8, thread_name_prefix="llm")


def generate_with_timeout(
    provider: ChatProvider,
    messages: list[ChatMessage],
    system: str,
    timeout: float,
) -> str:
    """Executa `provider.generate` com limite rigido de parede (TimeoutError apos `timeout`s).

    O cancelamento REAL de uma chamada em andamento depende do timeout do client
    do provedor (igual a llm_timeout_seconds); aqui so garantimos a resposta
    rapida ao chamador e removemos da fila futures que nem comecaram.
    """
    future = _LLM_EXECUTOR.submit(provider.generate, messages, system)
    try:
        return future.result(timeout=timeout)
    except TimeoutError:
        future.cancel()  # no-op se ja em execucao; evita rodar futures enfileiradas
        raise
