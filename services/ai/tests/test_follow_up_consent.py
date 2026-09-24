from types import SimpleNamespace

import pytest

from src.routes.reply import _follow_up_consent_reply, _select_operational_skill


@pytest.mark.parametrize(
    "skill_key, user_text",
    [
        ("support-follow-up-consent", "Pode me avisar quando tiver novidade?"),
        ("billing-follow-up-consent", "Pode me chamar quando houver retorno?"),
        ("sales-follow-up-consent", "Pode me ligar mais tarde?"),
    ],
)
def test_follow_up_asks_explicit_permission_in_every_sector(skill_key: str, user_text: str) -> None:
    reply = _follow_up_consent_reply(user_text, SimpleNamespace(key=skill_key))

    assert reply is not None
    assert "Posso retornar por aqui" in reply
    assert "atualização" in reply
    assert "vou" not in reply.lower()


def test_follow_up_does_not_treat_a_generic_question_as_permission() -> None:
    reply = _follow_up_consent_reply(
        "Como funciona a segunda via?", SimpleNamespace(key="billing-follow-up-consent")
    )

    assert reply is None


@pytest.mark.parametrize(
    "route_key, skill_key, user_text",
    [
        ("technical_support", "support-follow-up-consent", "Pode me avisar quando tiver uma atualizacao?"),
        ("billing", "billing-follow-up-consent", "Pode me retornar quando houver uma atualizacao?"),
        ("sales", "sales-follow-up-consent", "Pode me ligar depois?"),
    ],
)
def test_follow_up_skill_is_selected_only_for_an_explicit_request(
    route_key: str, skill_key: str, user_text: str
) -> None:
    skill = SimpleNamespace(
        key=skill_key,
        route_key=route_key,
        trigger_conditions=["retorno"],
        version=1,
        allowed_actions=["prepare_follow_up_consent"],
        protocol_steps=["Pedir consentimento"],
    )

    selected = _select_operational_skill([skill], route_key, user_text)

    assert selected is skill
