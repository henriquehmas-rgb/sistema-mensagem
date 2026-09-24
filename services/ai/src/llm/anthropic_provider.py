"""Provedor de chat Anthropic com cache de prompt e telemetria de uso."""

from __future__ import annotations

from .base import ChatMessage, ChatProvider, UsageSnapshot, merge_alternating


class AnthropicChat(ChatProvider):
    name = "anthropic"

    def __init__(
        self,
        api_key: str,
        model: str = "claude-haiku-4-5",
        timeout: float = 30.0,
        max_output_tokens: int = 1024,
        prompt_cache_enabled: bool = False,
        prompt_cache_ttl: str = "5m",
    ) -> None:
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
        self._model = model
        self._max_output_tokens = max_output_tokens
        self._prompt_cache_enabled = prompt_cache_enabled
        self._prompt_cache_ttl = prompt_cache_ttl

    def generate(self, messages: list[ChatMessage], system: str) -> str:
        history = merge_alternating(messages)
        if not history:
            return ""
        self.last_usage = None
        request = {
            "model": self._model,
            "system": system,
            "max_tokens": self._max_output_tokens,
            "messages": [{"role": m["role"], "content": m["content"]} for m in history],
        }
        # Sonnet 5 ativa adaptive thinking por padrão. Em atendimento curto isso
        # pode consumir todo o `max_tokens` e deixar o bloco de texto vazio.
        # A orquestração, as regras e as evidências já vêm resolvidas pelo Omni;
        # desabilitar o thinking aqui preserva a resposta e reduz custo/latência.
        if self._model.startswith(("claude-sonnet-5", "claude-opus-5")):
            request["thinking"] = {"type": "disabled"}
        if self._prompt_cache_enabled:
            request["cache_control"] = {"type": "ephemeral", "ttl": self._prompt_cache_ttl}
        response = self._client.messages.create(**request)
        usage = getattr(response, "usage", None)
        output_details = getattr(usage, "output_tokens_details", None)
        self.last_usage = UsageSnapshot(
            model=self._model,
            input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
            output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
            cached_input_tokens=int(getattr(usage, "cache_read_input_tokens", 0) or 0),
            cache_creation_input_tokens=int(
                getattr(usage, "cache_creation_input_tokens", 0) or 0
            ),
            reasoning_tokens=int(getattr(output_details, "thinking_tokens", 0) or 0),
        )
        parts = [block.text for block in response.content if getattr(block, "type", "") == "text"]
        return "\n".join(parts).strip()
