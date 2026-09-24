from src.conversation_style import (
    clarification_question,
    conversation_level,
    greeting_reply,
    period_greeting,
    needs_clarification,
    contextual_search_query,
    semantic_search_text,
)


def test_greeting_reply_preserves_period_and_is_natural() -> None:
    reply = greeting_reply("Boa noite", "conv-greeting", hour=21)
    assert reply is not None
    assert reply.startswith("Boa noite!")
    assert "em poucas palavras" not in reply
    assert "pelo caminho certo" not in reply
    assert "Tudo bem?" in reply


def test_colloquial_short_greeting_still_opens_naturally() -> None:
    for greeting in ("Oi", "Oii", "Oie", "Oieee", "Oiiiee", "Opa", "E ai", "Eai", "Fala", "Salve"):
        reply = greeting_reply(greeting, "conv-greeting", hour=9)
        assert reply is not None
        assert reply.startswith("Bom dia!")
    assert period_greeting(14) == "Boa tarde"
from src.schemas import ChatMessageIn
from src.triage import detect_intent


def test_ambiguous_messages_need_clarification() -> None:
    assert needs_clarification("Preciso de ajuda", detect_intent("Preciso de ajuda"))
    assert needs_clarification("Minha internet está ruim", detect_intent("Minha internet está ruim"))
    assert needs_clarification("boleto", detect_intent("boleto"))


def test_clear_messages_do_not_need_clarification() -> None:
    text = "Preciso da segunda via do boleto"
    assert not needs_clarification(text, detect_intent(text))
    text = "Estou completamente sem internet"
    assert not needs_clarification(text, detect_intent(text))


def test_variations_are_stable_and_do_not_repeat_consecutively() -> None:
    first = clarification_question("billing", "conv-1", 0)
    second = clarification_question("billing", "conv-1", 1)
    assert first != second
    assert first == clarification_question("billing", "conv-1", 0)


def test_conflicting_sectors_receive_a_specific_question() -> None:
    triage = detect_intent("Paguei a fatura e continuo sem internet")
    assert needs_clarification("Paguei a fatura e continuo sem internet", triage)
    question = clarification_question(
        triage.intent, "conv-1", 0, triage.secondary_intent
    )
    assert "conexão" in question
    assert "pagamento" in question


def test_conversation_levels() -> None:
    assert conversation_level("Já falei isso e ninguém resolve") == "acolhedor"
    assert conversation_level("Meu CPF é 123", sensitive=True) == "cauteloso"
    assert conversation_level("Como configurar o roteador?") == "passo_a_passo"
    assert conversation_level("Preciso de ajuda", clarifying=True) == "investigativo"


def test_contextual_search_uses_only_customer_messages() -> None:
    messages = [
        ChatMessageIn(role="user", content="Minha internet está ruim"),
        ChatMessageIn(role="assistant", content="Ela está lenta ou sem sinal?"),
        ChatMessageIn(role="user", content="Está lenta"),
    ]
    query = contextual_search_query(messages)
    assert query == "Minha internet está ruim | Está lenta"
    assert "sem sinal" not in query


def test_contextual_search_removes_a_leading_greeting_without_losing_the_question() -> None:
    messages = [
        ChatMessageIn(
            role="user",
            content="Boa noite. Como funciona o parcelamento da fatura?",
        ),
    ]

    assert contextual_search_query(messages) == "Como funciona o parcelamento da fatura?"


def test_semantic_search_removes_conversational_filler_from_a_new_request() -> None:
    assert semantic_search_text("Também quero saber quais planos de internet vocês têm.") == (
        "quais planos de internet vocês têm."
    )
