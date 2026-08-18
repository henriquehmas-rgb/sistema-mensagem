"""Fabrica de provedores de chat (AI_PROVIDER = mock|openai|anthropic|google)."""

from __future__ import annotations

from ..config import Settings, get_settings
from .base import ChatMessage, ChatProvider

__all__ = ["ChatMessage", "ChatProvider", "get_chat_provider"]


def get_chat_provider(settings: Settings | None = None) -> ChatProvider:
    """Instancia o ChatProvider configurado; imports tardios por provedor."""
    settings = settings or get_settings()
    provider = settings.ai_provider

    if provider == "mock":
        from .mock_provider import MockChat

        return MockChat()

    if provider == "openai":
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY e obrigatoria quando AI_PROVIDER=openai")
        from .openai_provider import OpenAIChat

        return OpenAIChat(
            api_key=settings.openai_api_key,
            model=settings.openai_chat_model,
            timeout=settings.llm_timeout_seconds,
        )

    if provider == "anthropic":
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY e obrigatoria quando AI_PROVIDER=anthropic")
        from .anthropic_provider import AnthropicChat

        return AnthropicChat(
            api_key=settings.anthropic_api_key,
            model=settings.anthropic_chat_model,
            timeout=settings.llm_timeout_seconds,
        )

    if provider == "google":
        if not settings.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY e obrigatoria quando AI_PROVIDER=google")
        from .google_provider import GoogleChat

        return GoogleChat(
            api_key=settings.google_api_key,
            model=settings.google_chat_model,
            timeout=settings.llm_timeout_seconds,
        )

    raise ValueError(f"AI_PROVIDER nao suportado: {provider}")
