"""Provedor de chat Google (gemini-2.0-flash) via google-genai."""

from __future__ import annotations

from .base import ChatMessage, ChatProvider, merge_alternating


class GoogleChat(ChatProvider):
    name = "google"

    def __init__(self, api_key: str, model: str = "gemini-2.0-flash", timeout: float = 30.0) -> None:
        from google import genai
        from google.genai import types

        self._types = types
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=int(timeout * 1000)),  # ms
        )
        self._model = model

    def generate(self, messages: list[ChatMessage], system: str) -> str:
        types = self._types
        contents = [
            types.Content(
                role="model" if m["role"] == "assistant" else "user",
                parts=[types.Part.from_text(text=m["content"])],
            )
            for m in merge_alternating(messages)
        ]
        response = self._client.models.generate_content(
            model=self._model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=0.2,
                max_output_tokens=512,
            ),
        )
        return (response.text or "").strip()
