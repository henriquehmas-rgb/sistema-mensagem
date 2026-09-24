import json

from src.config import Settings
from src.llm import orchestrator


def _messages(count: int):
    return [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"mensagem {index}"}
        for index in range(count)
    ]


def _valid_summary() -> str:
    return json.dumps(
        {
            "objetivo_cliente": "Resolver a conexão",
            "setor": "suporte",
            "problemas_confirmados": ["Sem sinal"],
            "informacoes_fornecidas": [],
            "procedimentos_realizados": [],
            "resultados": [],
            "pendencias": ["Verificar ONU"],
            "restricoes": [],
            "perguntas_em_aberto": [],
        }
    )


def test_short_history_does_not_call_auxiliary(monkeypatch) -> None:
    settings = Settings(ai_provider="mock", ai_auxiliary_provider="openai", openai_api_key="test")
    monkeypatch.setattr(
        orchestrator,
        "generate_with_timeout",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError),
    )
    result = orchestrator.prepare_history_context(settings, _messages(10))
    assert result.compacted is False
    assert result.messages == _messages(10)
    assert result.auxiliary_state is None


def test_long_history_compacts_only_old_messages_and_keeps_recent(monkeypatch) -> None:
    settings = Settings(ai_provider="mock", ai_auxiliary_provider="openai", openai_api_key="test")
    messages = _messages(15)
    captured = {}
    monkeypatch.setattr(orchestrator, "get_chat_provider", lambda settings, role: object())

    def generate(provider, old, system, timeout):
        captured["old"] = old
        return _valid_summary()

    monkeypatch.setattr(orchestrator, "generate_with_timeout", generate)
    result = orchestrator.prepare_history_context(settings, messages)
    assert result.compacted is True
    assert captured["old"] == messages[:-orchestrator.RECENT_MESSAGES]
    assert result.messages == messages[-orchestrator.RECENT_MESSAGES:]
    assert json.loads(result.auxiliary_state)["setor"] == "suporte"


def test_invalid_summary_falls_back_to_previous_history_limit(monkeypatch) -> None:
    settings = Settings(ai_provider="mock", ai_auxiliary_provider="openai", openai_api_key="test")
    messages = _messages(15)
    monkeypatch.setattr(orchestrator, "get_chat_provider", lambda settings, role: object())
    monkeypatch.setattr(
        orchestrator, "generate_with_timeout", lambda *args, **kwargs: "resumo livre"
    )
    result = orchestrator.prepare_history_context(settings, messages)
    assert result.compacted is False
    assert result.messages == messages[-orchestrator.FALLBACK_MESSAGES:]
    assert result.auxiliary_state is None


def test_auxiliary_failure_does_not_block_primary(monkeypatch) -> None:
    settings = Settings(ai_provider="mock", ai_auxiliary_provider="openai", openai_api_key="test")
    messages = _messages(15)
    monkeypatch.setattr(orchestrator, "get_chat_provider", lambda settings, role: object())

    def fail(*args, **kwargs):
        raise TimeoutError

    monkeypatch.setattr(orchestrator, "generate_with_timeout", fail)
    result = orchestrator.prepare_history_context(settings, messages)
    assert result.messages == messages[-orchestrator.FALLBACK_MESSAGES:]
    assert result.compacted is False


def test_summary_rejects_unknown_fields_and_invalid_sector() -> None:
    payload = json.loads(_valid_summary())
    payload["aprovacao"] = "sim"
    assert orchestrator._validate_auxiliary_state(json.dumps(payload)) is None
    payload.pop("aprovacao")
    payload["setor"] = "jurídico"
    assert orchestrator._validate_auxiliary_state(json.dumps(payload)) is None
