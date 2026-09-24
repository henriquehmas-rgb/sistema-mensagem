"""Provedor de chat OpenAI via Responses API."""

from __future__ import annotations

from .base import ChatMessage, ChatProvider, UsageSnapshot, merge_alternating


class OpenAIChat(ChatProvider):
    name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o-mini",
        timeout: float = 30.0,
        reasoning_effort: str = "low",
        max_output_tokens: int = 512,
    ) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key, timeout=timeout)
        self._model = model
        self._reasoning_effort = reasoning_effort
        self._max_output_tokens = max_output_tokens

    def generate(self, messages: list[ChatMessage], system: str) -> str:
        history = merge_alternating(messages)
        if not history:
            return ""
        self.last_usage = None
        request = {
            "model": self._model,
            "instructions": system,
            "input": [{"role": m["role"], "content": m["content"]} for m in history],
            "max_output_tokens": self._max_output_tokens,
        }
        # reasoning.effort pertence à família GPT-5; manter o adaptador
        # compatível com modelos anteriores configurados por ambientes legados.
        if self._model.startswith("gpt-5"):
            request["reasoning"] = {"effort": self._reasoning_effort}
        response = self._client.responses.create(**request)
        usage = getattr(response, "usage", None)
        input_details = getattr(usage, "input_tokens_details", None)
        output_details = getattr(usage, "output_tokens_details", None)
        self.last_usage = UsageSnapshot(
            model=self._model,
            input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
            output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
            cached_input_tokens=int(getattr(input_details, "cached_tokens", 0) or 0),
            cache_creation_input_tokens=int(getattr(input_details, "cache_write_tokens", 0) or 0),
            reasoning_tokens=int(getattr(output_details, "reasoning_tokens", 0) or 0),
        )
        return (response.output_text or "").strip()
