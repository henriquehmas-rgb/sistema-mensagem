"""Interface comum dos provedores de chat (LLM)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TypedDict


class ChatMessage(TypedDict):
    role: str  # "user" | "assistant"
    content: str


@dataclass(frozen=True)
class UsageSnapshot:
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    reasoning_tokens: int = 0


class ChatProvider(ABC):
    """`generate(messages, system) -> str` — resposta textual do modelo."""

    name: str = "base"
    last_usage: UsageSnapshot | None = None

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
