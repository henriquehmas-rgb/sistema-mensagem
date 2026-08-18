"""Provedor de chat Anthropic (claude-haiku-4-5)."""

from __future__ import annotations

from .base import ChatMessage, ChatProvider, merge_alternating


class AnthropicChat(ChatProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str = "claude-haiku-4-5", timeout: float = 30.0) -> None:
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key, timeout=timeout)
        self._model = model

    def generate(self, messages: list[ChatMessage], system: str) -> str:
        history = merge_alternating(messages)
        if not history:
            return ""
        response = self._client.messages.create(
            model=self._model,
            system=system,
            max_tokens=512,
            messages=[{"role": m["role"], "content": m["content"]} for m in history],
        )
        parts = [block.text for block in response.content if getattr(block, "type", "") == "text"]
        return "\n".join(parts).strip()
