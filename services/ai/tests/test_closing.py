import pytest

from src.closing import closing_kind, closing_message
from src.schemas import ChatMessageIn


def _conversation(last: str) -> list[ChatMessageIn]:
    return [
        ChatMessageIn(role="user", content="Preciso da segunda via da fatura"),
        ChatMessageIn(role="assistant", content="Enviei a segunda via para você."),
        ChatMessageIn(role="user", content=last),
    ]


def test_detects_contextual_closing_variations() -> None:
    assert closing_kind(_conversation("Obrigado")) == "thanks"
    assert closing_kind(_conversation("Entendi, obrigado pela orientação.")) == "thanks"
    assert closing_kind(_conversation("Entendi, obrigado pela orientação. Quando eu estiver com os dados, retorno por aqui.")) == "thanks"
    assert closing_kind(_conversation("Deu certo, obrigado")) == "resolved"
    assert closing_kind(_conversation("Perfeito, depois de alguns minutos a conexão voltou ao normal em todos os aparelhos. Obrigado pela orientação.")) == "resolved"
    assert closing_kind(_conversation("Tá tudo normal agora, obrigado.")) == "resolved"
    assert closing_kind(_conversation("A internet voltou, valeu pela ajuda.")) == "resolved"
    assert closing_kind(_conversation("Até mais")) == "general"
    assert closing_kind(_conversation("Não, obrigado")) == "resolved"


@pytest.mark.parametrize(
    "message",
    (
        "Obrigado, vou procurar os dados e retorno depois.",
        "Valeu pela ajuda. Quando achar meu CPF, volto por aqui.",
        "Obrigada, vou pegar os dados e chamo vocês mais tarde.",
        "Beleza, agradeço. Retornarei quando estiver com os dados.",
    ),
)
def test_detects_thanks_with_common_future_return_variations(message: str) -> None:
    assert closing_kind(_conversation(message)) == "thanks"


def test_does_not_close_on_first_message_or_new_question() -> None:
    assert closing_kind([ChatMessageIn(role="user", content="Obrigado")]) is None
    assert closing_kind(_conversation("Obrigado, mas e o vencimento?")) is None


def test_closing_is_natural_and_stable_without_repeating_the_brand() -> None:
    message = closing_message("thanks", "conv-1")
    assert message == closing_message("thanks", "conv-1")
    assert "Grupo SEEG" not in message
    lowered = message.casefold()
    assert "automação" not in lowered
    assert "abandon" not in lowered
    assert "paus" not in lowered
    assert "encerr" not in lowered
