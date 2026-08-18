"""Provedor de chat OpenAI (gpt-4o-mini)."""

from __future__ import annotations

from .base import ChatMessage, ChatProvider, merge_alternating


class OpenAIChat(ChatProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str = "gpt-4o-mini", timeout: float = 30.0) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key, timeout=timeout)
        self._model = model

    def generate(self, messages: list[ChatMessage], system: str) -> str:
        history = merge_alternating(messages)
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                *[{"role": m["role"], "content": m["content"]} for m in history],
            ],
            temperature=0.2,
            max_tokens=512,
        )
        return (response.choices[0].message.content or "").strip()
