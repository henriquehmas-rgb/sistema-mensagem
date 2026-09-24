from src.routes.reply import _case_summary
from src.schemas import ChatMessageIn


def test_case_summary_ignores_greeting_and_keeps_customer_need() -> None:
    messages = [
        ChatMessageIn(role="user", content="Olá"),
        ChatMessageIn(role="assistant", content="Como posso ajudar?"),
        ChatMessageIn(role="user", content="Quero conhecer os planos de internet"),
    ]

    assert _case_summary(messages) == "Quero conhecer os planos de internet"


def test_case_summary_is_bounded() -> None:
    messages = [ChatMessageIn(role="user", content="palavra " * 100)]

    summary = _case_summary(messages)
    assert summary is not None
    assert len(summary) <= 280
