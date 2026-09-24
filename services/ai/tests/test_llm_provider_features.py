from __future__ import annotations

from types import SimpleNamespace

from src.config import Settings
from src.llm import get_chat_provider
from src.llm.anthropic_provider import AnthropicChat
from src.llm.openai_provider import OpenAIChat


def test_factory_separates_primary_and_auxiliary_models() -> None:
    settings = Settings(
        ai_provider="mock",
        ai_primary_provider="anthropic",
        ai_auxiliary_provider="openai",
        anthropic_api_key="sk-ant-test-key-with-safe-length",
        openai_api_key="sk-test-key-with-safe-length",
        anthropic_chat_model="claude-sonnet-5",
        openai_chat_model="gpt-5.6-luna",
    )

    primary = get_chat_provider(settings, role="primary")
    auxiliary = get_chat_provider(settings, role="auxiliary")

    assert isinstance(primary, AnthropicChat)
    assert primary._model == "claude-sonnet-5"
    assert isinstance(auxiliary, OpenAIChat)
    assert auxiliary._model == "gpt-5.6-luna"


def test_anthropic_enables_automatic_cache_and_captures_usage(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    response = SimpleNamespace(
        content=[SimpleNamespace(type="text", text="Resposta natural")],
        usage=SimpleNamespace(
            input_tokens=120,
            output_tokens=30,
            cache_read_input_tokens=80,
            cache_creation_input_tokens=40,
            output_tokens_details=SimpleNamespace(thinking_tokens=12),
        ),
    )

    class _Messages:
        @staticmethod
        def create(**kwargs):
            calls.append(kwargs)
            return response

    monkeypatch.setattr(
        "anthropic.Anthropic",
        lambda **_kwargs: SimpleNamespace(messages=_Messages()),
    )
    provider = AnthropicChat(
        "sk-ant-test-key",
        model="claude-sonnet-5",
        prompt_cache_enabled=True,
        prompt_cache_ttl="5m",
    )

    result = provider.generate([{"role": "user", "content": "Olá"}], "Diretrizes")

    assert result == "Resposta natural"
    assert calls[0]["thinking"] == {"type": "disabled"}
    assert calls[0]["cache_control"] == {"type": "ephemeral", "ttl": "5m"}
    assert provider.last_usage is not None
    assert provider.last_usage.cached_input_tokens == 80
    assert provider.last_usage.cache_creation_input_tokens == 40
    assert provider.last_usage.reasoning_tokens == 12


def test_openai_uses_responses_api_with_low_reasoning_and_captures_usage(monkeypatch) -> None:
    calls: list[dict[str, object]] = []
    response = SimpleNamespace(
        output_text="Resumo interno",
        usage=SimpleNamespace(
            input_tokens=90,
            output_tokens=20,
            input_tokens_details=SimpleNamespace(cached_tokens=50),
            output_tokens_details=SimpleNamespace(reasoning_tokens=8),
        ),
    )

    class _Responses:
        @staticmethod
        def create(**kwargs):
            calls.append(kwargs)
            return response

    monkeypatch.setattr(
        "openai.OpenAI",
        lambda **_kwargs: SimpleNamespace(responses=_Responses()),
    )
    provider = OpenAIChat(
        "sk-test-key",
        model="gpt-5.6-luna",
        reasoning_effort="low",
        max_output_tokens=512,
    )

    result = provider.generate([{"role": "user", "content": "Resuma"}], "Diretrizes")

    assert result == "Resumo interno"
    assert calls[0]["model"] == "gpt-5.6-luna"
    assert calls[0]["reasoning"] == {"effort": "low"}
    assert calls[0]["max_output_tokens"] == 512
    assert provider.last_usage is not None
    assert provider.last_usage.cached_input_tokens == 50
    assert provider.last_usage.reasoning_tokens == 8
