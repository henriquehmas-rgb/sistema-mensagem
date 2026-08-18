"""Interface comum dos provedores de chat (LLM)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TypedDict


class ChatMessage(TypedDict):
    role: str  # "user" | "assistant"
    content: str


class ChatProvider(ABC):
    """`generate(messages, system) -> str` — resposta textual do modelo."""

    name: str = "base"

    @abstractmethod
    def generate(self, messages: list[ChatMessage], system: str) -> str:
        """Gera a resposta do assistente para o historico + system prompt."""


def merge_alternating(messages: list[ChatMessage]) -> list[ChatMessage]:
    """Normaliza o historico: descarta roles invalidas e funde turnos consecutivos
    da mesma role (exigencia de APIs como a da Anthropic)."""
    merged: list[ChatMessage] = []
    for message in messages:
        role = message["role"]
        if role not in ("user", "assistant"):
            continue
        if merged and merged[-1]["role"] == role:
            merged[-1]["content"] = f"{merged[-1]['content']}\n{message['content']}"
        else:
            merged.append({"role": role, "content": message["content"]})
    return merged
