"""Fabrica de provedores de chat (AI_PROVIDER = mock|openai|anthropic|google)."""

from __future__ import annotations

from ..config import Settings, get_settings
from .base import ChatMessage, ChatProvider

__all__ = ["ChatMessage", "ChatProvider", "get_chat_provider"]


def get_chat_provider(settings: Settings | None = None, role: str = "primary") -> ChatProvider:
    """Instancia o ChatProvider configurado; imports tardios por provedor."""
    settings = settings or get_settings()
    role_provider = {
        "primary": settings.ai_primary_provider,
        "auxiliary": settings.ai_auxiliary_provider,
        "review": settings.ai_review_provider,
        "fallback": settings.ai_fallback_provider,
    }.get(role)
    if role not in {"primary", "auxiliary", "review", "fallback"}:
        raise ValueError(f"papel de provedor nao suportado: {role}")
    provider = role_provider or settings.ai_provider

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
            reasoning_effort=settings.openai_reasoning_effort,
            max_output_tokens=settings.openai_max_output_tokens,
        )

    if provider == "anthropic":
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY e obrigatoria quando AI_PROVIDER=anthropic")
        from .anthropic_provider import AnthropicChat

        return AnthropicChat(
            api_key=settings.anthropic_api_key,
            model=settings.anthropic_chat_model,
            timeout=settings.llm_timeout_seconds,
            max_output_tokens=settings.anthropic_max_output_tokens,
            prompt_cache_enabled=settings.anthropic_prompt_cache_enabled,
            prompt_cache_ttl=settings.anthropic_prompt_cache_ttl,
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
